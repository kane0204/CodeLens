"""Loopback-only web adapter; source stays in memory and is never executed."""
import argparse
import json
import logging
import secrets
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

CODE_ROOT = Path(__file__).resolve().parents[1]
if str(CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CODE_ROOT))

from core_engine.engine import analyze, VERSION
from core_engine import health
from core_engine import rules as extra_rules
from core_engine import sequence
from core_engine import quality
from core_engine import special
from core_engine.ir import build_index
from ai import contract as ai_contract
from ai import provider as ai_provider
from ai import runner as ai_runner
from ai import skills as ai_skills
from ai import explanation
from backend import observability as obs

# 18766 只提供 JSON API；界面是独立的 codelens-prototype（Vite，5173）。
TOKEN = secrets.token_urlsafe(32)
API_REVISION = 2
CAPABILITIES = ["analyze", "explain", "explain-context", "project-review", "class-metrics",
                "duplicates", "class-relations", "multi-language", "special-risks"]
MAX_BODY = 12 * 1024 * 1024
MAX_AI_TARGETS = ai_runner.MAX_TARGETS


def ai_error(code, message):
    """AI 接口的错误体：结构化的 code 便于前端区分"没开""没证据""参数错"。"""
    return {"error": {"code": code, "message": message}}


# 补充规则单列在这里：引擎 config.rules 仍然只列引擎自己执行的规则，
# 前端靠这份清单判断「设计检查」页该展示哪几条。
EXTRA_RULE_IDS = ("SRP-01", "OCP-01", "LSP-01", "ISP-01", "DIP-01", "A5-DEAD", "A8-DEFENSIVE")


def merge_extra(result):
    """把补充规则（S/O/D、死代码、防御式捕获）并入引擎结果，返回 (merged, extra)。

    只新增 findings 与 config.rules 里的规则名，不改动引擎已产出的键值。
    """
    extra = extra_rules.evaluate(result)
    merged = extra_rules.merge(result, extra)
    config = merged.get("config")
    if not isinstance(config, dict):
        config = {}
        merged["config"] = config
    ids = [item for item in (config.get("rules") or []) if isinstance(item, str)]
    for rule_id in EXTRA_RULE_IDS:
        if rule_id not in ids:
            ids.append(rule_id)
    config["rules"] = ids
    merged["extra_rules"] = {
        "findings": len(extra.get("findings") or []),
        "metrics": extra.get("metrics") or {},
        "notes": list(extra.get("notes") or []),
    }
    return merged, extra


def enrich(result):
    """analyze() 之后补齐三样前端需要的派生数据：补充规则、健康度得分、时序序列。

    三者都是确定性计算，不含模型、不含随机；analyze() 本身的返回契约不受影响。
    """
    if not isinstance(result, dict) or result.get("status") in ("empty", "failed"):
        return result
    merged, _ = merge_extra(result)
    merged = quality.apply(merged)
    merged["limitations"] = ["静态分析不执行源码；动态调用与运行时行为无法完整还原。", *extra_rules.NOTES, *quality.NOTES]
    merged = health.apply(merged)
    merged["sequence"] = sequence.build(merged)
    merged["special_risks"] = special.build(merged)
    return merged



def ai_status():
    """AI 层的自述：有哪些 skill、当前用哪个 provider、各项上限是多少。"""
    provider, degraded = ai_provider.resolve_provider()
    return {
        "ready": True,
        "enabled": True,
        "template_only": provider.kind == "template",
        "providers": [item.describe() for item in ai_provider.candidates()],
        "skills": ai_skills.catalogue(),
        "limits": {
            "max_targets": ai_runner.MAX_TARGETS,
            "max_claims_per_result": ai_contract.MAX_CLAIMS_PER_RESULT,
            "max_claim_chars": ai_contract.MAX_CLAIM_CHARS,
        },
        "degraded": degraded,
        "limitations": list(ai_runner.LIMITATIONS),
    }


def _validate_ai_payload(payload):
    """校验 AI 表达层请求的信封字段，非法时抛 SkillError。"""
    if not isinstance(payload, dict):
        raise ai_contract.SkillError("refused", "请求必须是 JSON 对象")
    skills = payload.get("skills")
    if not isinstance(skills, list) or not skills:
        raise ai_contract.SkillError("refused", "skills 必须是非空数组")
    unknown = [item for item in skills if not isinstance(item, str) or item not in ai_contract.SKILLS]
    if unknown:
        raise ai_contract.SkillError("refused", "未注册的 skill：" + "、".join(str(x)[:40] for x in unknown[:4]))
    _validate_ai_targets(payload.get("targets"))


def _validate_ai_targets(targets):
    if targets is None:
        return
    if not isinstance(targets, list) or not all(isinstance(item, str) for item in targets):
        raise ai_contract.SkillError("refused", "targets 必须是字符串数组或 null")
    if len(targets) > MAX_AI_TARGETS:
        raise ai_contract.SkillError("refused", "targets 超过上限 " + str(MAX_AI_TARGETS))


def ai_analyze(payload):
    """跑一次 AI 表达层。事实层仍然是 `analyze()`，这里只做"把事实讲清楚"。"""
    _validate_ai_payload(payload)
    skills = payload.get("skills")
    targets = payload.get("targets")
    options = payload.get("options") or {}
    if not isinstance(options, dict):
        raise ai_contract.SkillError("refused", "options 必须是对象")
    include_text = options.get("include_text", True) is not False

    result = analyze({"project": payload.get("project"), "files": payload.get("files") or []})
    if result.get("status") in ("empty", "failed"):
        return {
            "schema_version": ai_contract.SCHEMA_VERSION,
            "engine_version": VERSION,
            "project": result.get("project"),
            "targets": [],
            "results": [],
            "summary": {"requested": 0, "ok": 0, "insufficient_evidence": 0,
                        "need_more": 0, "refused": 0,
                        "citations": {"count": 0, "resolved": 0, "unresolved": 0, "coverage": 0.0}},
            "warnings": [{"code": "no-source", "message": "本次没有可分析的源码，AI 层未执行。"}],
            "limitations": list(ai_runner.LIMITATIONS),
        }

    # 补充规则（SOLID 的 S/O/D、A5、A8）只并入这条 AI 路径，不改 analyze() 的契约。
    merged, extra = merge_extra(result)
    index = build_index(merged)
    env = ai_runner.build_env(index, rules=extra)
    env["ensure_trees"]()
    provider, degraded = ai_provider.resolve_provider()
    outcome = ai_runner.Runner(env, provider=provider).run(skills, targets=targets)

    results = outcome["results"]
    if not include_text:
        for item in results:
            item["outputs"] = {}
            item["notes"] = []
    warnings = list(outcome["warnings"])
    if degraded:
        warnings.append({"code": "provider-fallback",
                         "message": "外部模型不可用，已退回确定性模板：" + degraded})
    if extra.get("notes"):
        warnings.append({"code": "extra-rules", "message": "；".join(extra["notes"])})
    return {
        "schema_version": ai_contract.SCHEMA_VERSION,
        "engine_version": VERSION,
        "project": result.get("project"),
        "targets": [item["target"] for item in results],
        "results": results,
        "summary": outcome["summary"],
        "warnings": warnings,
        "limitations": list(outcome["limitations"]),
    }


# 界面资源由 codelens-prototype 在 5173 提供，本服务不再托管静态文件。

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        # The base class echoes the raw request line, which may carry private
        # data. Structured, redacted request records come from _dispatch below.
        pass

    def request_path(self):
        return urlsplit(self.path).path

    def send_data(self, status, body, mime="application/json"):
        # Every error response carries the same correlation id the user sees in
        # the UI and that appears in the server log.
        if status >= 400 and isinstance(body, dict) and "error" in body:
            body = {**body, "request_id": getattr(self, "request_id", "-")}
        data = body if isinstance(body, bytes) else json.dumps(body,ensure_ascii=False).encode("utf-8")
        self.response_status = status
        self.bytes_out = getattr(self, "bytes_out", 0) + len(data)
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            obs.log_event(obs.get_logger(), logging.DEBUG, "response_aborted",
                          request_id=getattr(self, "request_id", "-"), status=status)
        return len(data)

    def allowed_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def stream_review(self, payload):
        logger = obs.get_logger()
        rid = getattr(self, "request_id", "-")
        self.response_status = 200
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        # If the browser aborts mid-review, keep the job running server-side:
        # per-batch checkpoints let a later retry resume (see ai.explanation.review).
        disconnected = False

        def emit(event):
            nonlocal disconnected
            if disconnected:
                return
            try:
                line = (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")
                self.wfile.write(line)
                self.wfile.flush()
                self.bytes_out = getattr(self, "bytes_out", 0) + len(line)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                if not disconnected:
                    obs.log_event(logger, logging.DEBUG, "stream_client_disconnected", request_id=rid)
                disconnected = True

        def fail(message):
            emit({"type": "error", "error": message, "error_id": rid})

        try:
            result = explanation.review(payload, progress=emit)
            emit({"type": "result", "result": result})
        except explanation.ExplanationError as exc:
            obs.log_event(logger, logging.WARNING, "review_refused", request_id=rid,
                          type=type(exc).__name__)
            fail(obs.redact(str(exc)))
        except (ValueError, UnicodeError, TypeError) as exc:
            obs.log_event(logger, logging.WARNING, "review_invalid_input", request_id=rid,
                          type=type(exc).__name__)
            fail(obs.redact(str(exc)))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            obs.log_event(logger, logging.DEBUG, "review_transport_closed", request_id=rid)
        except Exception as exc:
            obs.log_exception(logger, exc, rid, method="POST", path="/api/review")
            fail("AI 审查失败；未生成替代结论")

    def dispatch(self, method, handler):
        """One place for timing, status tracking and the last-resort exception guard."""
        self.request_id = obs.new_id()
        self.response_status = 0
        self.bytes_out = 0
        logger = obs.get_logger()
        path = self.request_path()
        started = time.perf_counter()
        error_type = None
        try:
            handler()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            error_type = "client_disconnect"
            obs.log_event(logger, logging.DEBUG, "client_disconnect",
                          request_id=self.request_id, method=method)
        except Exception as exc:
            error_type = type(exc).__name__
            obs.log_exception(logger, exc, self.request_id, method=method,
                              path=obs.safe_path(path))
            if not self.response_status:
                self.send_data(500, {"error": "服务内部错误，请重试；未生成替代结果"})
        finally:
            obs.log_request(
                logger,
                method=method,
                path=path,
                status=self.response_status or 599,
                duration_ms=(time.perf_counter() - started) * 1000,
                request_id=self.request_id,
                bytes_out=self.bytes_out or None,
                error_type=error_type,
            )

    def do_GET(self):
        return self.dispatch("GET", self.handle_get)

    def do_POST(self):
        return self.dispatch("POST", self.handle_post)

    def handle_get(self):
        if not self.allowed_host():
            return self.send_data(403,{"error":"只允许本机访问"})
        path = self.request_path()
        if path == "/api/status":
            return self.send_data(200,{"ready":True,"engine_version":VERSION,"api_revision":API_REVISION,
                                      "capabilities":CAPABILITIES,"token":TOKEN})
        if path == "/api/ai/status":
            return self.send_data(200, ai_status())
        return self.send_data(404,{"error":"接口不存在；界面请访问 http://localhost:5173"})

    def handle_post(self):
        logger = obs.get_logger()
        if not self._post_allowed():
            obs.log_event(logger, logging.WARNING, "request_rejected",
                          request_id=self.request_id, reason="guard")
            return self.send_data(403,{"error":"请从本机 CodeLens 页面发起分析"})
        path = self.request_path()
        if path not in ("/api/analyze", "/api/ai", "/api/explain", "/api/review"):
            return self.send_data(404,{"error":"接口不存在"})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_data(415,{"error":"仅支持 JSON 请求"})
        return self._process_post(path, logger)

    def _post_allowed(self):
        origin = self.headers.get("Origin")
        origins = {f"http://127.0.0.1:{self.server.server_port}",f"http://localhost:{self.server.server_port}"}
        return self.allowed_host() and origin in origins and self.headers.get("X-CodeLens-Token") == TOKEN

    def _process_post(self, path, logger):
        try:
            length = int(self.headers.get("Content-Length","0"))
            if not 0 < length <= MAX_BODY:
                return self.send_data(413,{"error":"请求超过 12 MB 或为空"})
            return self._route_post(path, self._read_post(length))
        except explanation.ExplanationError as exc:
            obs.log_event(logger, logging.WARNING, "explain_refused",
                          request_id=self.request_id, type=type(exc).__name__)
            return self.send_data(502, {"error": obs.redact(str(exc))})
        except ai_contract.SkillError as exc:
            obs.log_event(logger, logging.WARNING, "skill_refused",
                          request_id=self.request_id, kind=obs.redact(exc.kind, 40))
            return self._post_skill_error(path, exc)
        except TimeoutError:
            obs.log_event(logger, logging.WARNING, "request_read_timeout",
                          request_id=self.request_id)
            return self.send_data(408, {"error": "读取请求超时，请重试"})
        except (ValueError, UnicodeError, TypeError) as exc:
            obs.log_event(logger, logging.WARNING, "invalid_request",
                          request_id=self.request_id, type=type(exc).__name__)
            return self.send_data(400,{"error":obs.redact(str(exc))})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            raise  # handled by dispatch as a client disconnect
        except Exception as exc:
            obs.log_exception(logger, exc, self.request_id, method="POST",
                              path=obs.safe_path(path))
            return self._post_internal_error(path)

    def _read_post(self, length):
        self.connection.settimeout(30)
        data = self.rfile.read(length)
        if len(data) != length:
            raise ValueError("请求数据不完整")
        return json.loads(data)

    def _route_post(self, path, payload):
        if path == "/api/explain":
            return self.send_data(200, explanation.explain(payload))
        if path == "/api/review":
            return self.stream_review(payload)
        if path == "/api/ai":
            return self.send_data(200, ai_analyze(payload))
        return self.send_data(200, enrich(analyze(payload)))

    def _post_skill_error(self, path, exc):
        if path == "/api/ai":
            return self.send_data(400, ai_error(exc.kind, str(exc)[:200]))
        return self.send_data(400, {"error": obs.redact(str(exc))})

    def _post_internal_error(self, path):
        if path == "/api/ai":
            return self.send_data(500, ai_error("internal", "AI 解读失败；未生成替代结论"))
        return self.send_data(500,{"error":"分析失败，请缩小项目范围后重试；未生成替代结果"})


def main():
    parser = argparse.ArgumentParser(description="CodeLens 本机多语言静态分析")
    parser.add_argument("--port",type=int,default=18766)
    parser.add_argument("--log-level", choices=sorted(obs.LEVELS), default=None,
                        help="日志级别；默认取 CODELENS_LOG_LEVEL 或 INFO")
    parser.add_argument("--log-file", default=None,
                        help="可选的轮转日志文件路径；默认取 CODELENS_LOG_FILE，仅记录元数据")
    args = parser.parse_args()
    if sys.version_info < (3,11):
        raise SystemExit("需要 Python 3.11 或更高版本")
    logger = obs.configure_logging(args.log_level, args.log_file)
    try:
        server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    except OSError as exc:
        obs.log_event(logger, logging.ERROR, "startup_failed", port=args.port,
                      type=type(exc).__name__)
        raise SystemExit(f"无法启动端口 {args.port}，可使用 --port 更换端口：{exc}")
    print(f"CodeLens {VERSION} API: http://127.0.0.1:{server.server_port} (JSON only)",flush=True)
    print("Open the UI at http://localhost:5173 (see README). Ctrl+C to stop.",flush=True)
    obs.log_event(logger, logging.INFO, "startup", version=VERSION, port=server.server_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        obs.log_event(logger, logging.INFO, "shutdown", reason="keyboard_interrupt")
    except Exception as exc:
        obs.log_exception(logger, exc, obs.new_id(), event="serve_forever")
        raise
    finally:
        server.server_close()
        obs.log_event(logger, logging.INFO, "stopped", port=server.server_port)


if __name__ == "__main__":
    main()
