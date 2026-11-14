"""FastAPI transport for the local CodeLens workbench."""
import argparse
import asyncio
import json
import logging
import os
import sqlite3
from pathlib import Path
import sys
import threading
import time

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from backend import observability as obs, server as core
from backend.history import DEFAULT_PATH as HISTORY_PATH, HistoryStore


class SourceRequest(BaseModel):
    project: str = "代码项目"
    files: list[dict]
    history_project: str | None = None


class ReviewRequest(SourceRequest):
    provider: dict | None = None
    scope: str = "project"
    history_run: int | None = None
    use_history: bool = True


class HistoryRequest(BaseModel):
    project_id: str
    analysis_id: int | None = None


class ExplainRequest(ReviewRequest):
    target: dict
    include_context: bool = True


class SkillRequest(SourceRequest):
    skills: list[str]
    targets: list[str] | None = None
    options: dict | None = None


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def _guard(request):
    port = request.scope["server"][1]
    hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
    if request.headers.get("host") not in hosts:
        raise RequestError(403, "只允许本机访问")
    if request.method == "POST":
        _guard_post(request, hosts)


def _guard_post(request, hosts):
    origins = {"http://" + host for host in hosts}
    if request.headers.get("origin") not in origins or request.headers.get("x-codelens-token") != core.TOKEN:
        raise RequestError(403, "请从本机 CodeLens 页面发起分析")


async def _read_payload(request: Request):
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise RequestError(415, "仅支持 JSON 请求")
    declared = request.headers.get("content-length")
    if declared is not None and not 0 < int(declared) <= core.MAX_BODY:
        raise RequestError(413, "请求超过 12 MB 或为空")
    body = bytearray()
    async with asyncio.timeout(30):
        async for chunk in request.stream():
            if len(body) + len(chunk) > core.MAX_BODY:
                raise RequestError(413, "请求超过 12 MB 或为空")
            body.extend(chunk)
    if not body:
        raise RequestError(413, "请求超过 12 MB 或为空")
    return json.loads(body)


def _error(request, exc):
    if isinstance(exc, RequestError):
        return exc.status, str(exc)
    if isinstance(exc, core.explanation.ExplanationError):
        return 502, obs.redact(str(exc))
    if isinstance(exc, core.ai_contract.SkillError):
        return 400, core.ai_error(exc.kind, str(exc)[:200])["error"]
    if isinstance(exc, TimeoutError):
        return 408, "读取请求超时，请重试"
    if isinstance(exc, (ValueError, TypeError)):
        return 400, obs.redact(str(exc))
    obs.log_exception(obs.get_logger(), exc, request.state.request_id,
                      method=request.method, path=obs.safe_path(request.url.path))
    return 500, "服务内部错误，请重试"


async def _observe(request, call_next):
    request.state.request_id = obs.new_id()
    started = time.perf_counter()
    error_type = None
    try:
        _guard(request)
        response = await call_next(request)
    except Exception as exc:
        error_type = type(exc).__name__
        status, error = _error(request, exc)
        response = JSONResponse({"error": error, "request_id": request.state.request_id}, status)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Request-ID"] = request.state.request_id
    obs.log_request(obs.get_logger(), request_id=request.state.request_id, method=request.method,
                    path=request.url.path, status=response.status_code, error_type=error_type,
                    duration_ms=(time.perf_counter() - started) * 1000)
    return response


def _produce_review(request, payload, store, emit, history):
    logger = obs.get_logger()
    rid = request.state.request_id
    obs.log_event(logger, logging.INFO, "review.start", request_id=rid)
    options = {}

    def progress(event):
        obs.log_event(logger, logging.INFO, "review.progress", request_id=rid,
                      stage=event["stage"], done=event["done"], total=event["total"])
        emit(event)

    try:
        payload = _validate(payload, ReviewRequest)
        options = _review_history(history, payload)
        _review_status(history, options, payload, "running")
        result = core.explanation.review(payload, progress=progress, store=_review_store(store, history, options), **options)
        _review_status(history, options, payload, "done", result)
        emit({"type": "result", "result": result})
        obs.log_event(logger, logging.INFO, "review.done", request_id=rid)
    except BrokenPipeError:
        _review_status(history, options, payload, "paused")
        obs.log_event(logger, logging.DEBUG, "review_transport_closed", request_id=rid)
    except Exception as exc:
        _review_status(history, options, payload, "failed")
        status, error = _error(request, exc)
        obs.log_event(logger, logging.WARNING, "review.failed", request_id=rid,
                      status=status, type=type(exc).__name__)
        emit({"type": "error", "error": error, "error_id": rid})


async def _review_stream(request, payload, store, history=None):
    loop = asyncio.get_running_loop()
    events = asyncio.Queue()
    stopped = threading.Event()

    def emit(event):
        if stopped.is_set():
            raise BrokenPipeError()
        loop.call_soon_threadsafe(events.put_nowait, event)

    def work():
        try:
            _produce_review(request, payload, store, emit, history)
        except BrokenPipeError:
            pass
        finally:
            if not stopped.is_set():
                loop.call_soon_threadsafe(events.put_nowait, None)

    worker = asyncio.create_task(run_in_threadpool(work))
    try:
        while (event := await events.get()) is not None:
            yield json.dumps(event, ensure_ascii=False) + "\n"
    finally:
        stopped.set()
        worker.cancel()


def _schema(model):
    return {"requestBody": {"required": True, "content": {
        "application/json": {"schema": model.model_json_schema()},
    }}}


def _validate(payload, model):
    try:
        model.model_validate(payload)
    except ValidationError as exc:
        field = ".".join(map(str, exc.errors(include_input=False)[0]["loc"]))
        raise RequestError(400, f"请求字段格式无效：{field}" if field else "请求必须是 JSON 对象") from None
    return payload


def _review_history(history, payload):
    project, run = payload.get("history_project"), payload.get("history_run")
    if history is None or not project or not run:
        return {}
    paths = [file.get("path") for file in payload["files"]]
    memory = history.memory(project, run, paths, payload.get("use_history", True))
    return {"memory": memory, "history_project": project}


def _review_status(history, options, payload, status, result=None):
    if options and payload.get("scope", "project") == "project":
        try:
            history.save_review(options["history_project"], payload["history_run"], status, result)
        except (OSError, sqlite3.Error) as exc:
            obs.log_event(obs.get_logger(), logging.WARNING, "history.write_failed", type=type(exc).__name__)


def _review_store(store, history, options):
    return history.checkpoints(options["history_project"]) if options else store


def create_app(store, history=None):
    app = FastAPI(title="CodeLens API", version=core.VERSION, redoc_url=None)
    app.middleware("http")(_observe)
    _routes(app, store, history)
    if history is not None:
        _history_routes(app, history)
    return app


def _routes(app, store, history):
    @app.get(obs.API_STATUS)
    def status():
        capabilities = core.CAPABILITIES + (["project-history"] if history is not None else [])
        return {"ready": True, "engine_version": core.VERSION, "api_revision": core.API_REVISION,
                "capabilities": capabilities, "token": core.TOKEN}

    @app.get(obs.API_AI_STATUS)
    def ai_status():
        return core.ai_status()

    @app.post(obs.API_ANALYZE, openapi_extra=_schema(SourceRequest))
    def analyze(payload=Depends(_read_payload)):
        result = core.enrich(core.analyze(_validate(payload, SourceRequest)))
        if history is not None and "history_project" in payload and result["summary"]["parsed"]:
            result["history"] = history.record(result, payload["history_project"])
        return result

    @app.post(obs.API_EXPLAIN, openapi_extra=_schema(ExplainRequest))
    def explain(payload=Depends(_read_payload)):
        return core.explanation.explain(_validate(payload, ExplainRequest))

    @app.post(obs.API_AI, openapi_extra=_schema(SkillRequest))
    def skills(payload=Depends(_read_payload)):
        return core.ai_analyze(payload)

    @app.post(obs.API_REVIEW, response_class=StreamingResponse, openapi_extra=_schema(ReviewRequest))
    def review(request: Request, payload=Depends(_read_payload)):
        return StreamingResponse(_review_stream(request, payload, store, history), media_type="application/x-ndjson")

    @app.post(obs.API_REVIEW_CACHED, openapi_extra=_schema(ReviewRequest))
    def cached(payload=Depends(_read_payload)):
        payload = _validate(payload, ReviewRequest)
        options = _review_history(history, payload)
        return {"result": core.explanation.cached_review(payload, _review_store(store, history, options), **options)}


def _history_routes(app, history):
    @app.post("/api/history/projects")
    def projects(payload=Depends(_read_payload)):
        return history.projects()

    @app.post("/api/history/runs", openapi_extra=_schema(HistoryRequest))
    def runs(payload=Depends(_read_payload)):
        return history.runs(_validate(payload, HistoryRequest)["project_id"])

    @app.post("/api/history/detail", openapi_extra=_schema(HistoryRequest))
    def detail(payload=Depends(_read_payload)):
        request = HistoryRequest.model_validate(_validate(payload, HistoryRequest))
        return history.detail(request.project_id, request.analysis_id)

    @app.post("/api/history/delete", openapi_extra=_schema(HistoryRequest))
    def delete(payload=Depends(_read_payload)):
        history.delete(_validate(payload, HistoryRequest)["project_id"])
        return {"deleted": True}


def main():
    parser = argparse.ArgumentParser(description="CodeLens FastAPI 本机服务")
    parser.add_argument("--port", type=int, default=18766)
    parser.add_argument("--log-level", choices=sorted(obs.LEVELS))
    parser.add_argument("--log-file")
    parser.add_argument("--no-log-file", action="store_true")
    args = parser.parse_args()
    logger = obs.configure_logging(args.log_level, args.log_file, enable_file=not args.no_log_file)
    obs.install_crash_hooks(logger)
    store = core.ReviewStore(os.environ.get("CODELENS_REVIEW_DB") or core.DEFAULT_PATH)
    history = HistoryStore(os.environ.get("CODELENS_HISTORY_DB") or HISTORY_PATH)
    uvicorn.run(create_app(store, history), host="127.0.0.1", port=args.port, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()
