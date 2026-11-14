"""Verify the FastAPI adapter using HTTP-shaped requests without opening a socket."""
import asyncio
import json
import runpy
import sqlite3
from pathlib import Path
import sys
import threading
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from backend import asgi, server


class FastApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.store = object()
        self.app = asgi.create_app(self.store)
        self.payload = {"project": "demo", "files": [{"path": "main.py", "content": "pass"}]}
        logger = patch.object(asgi.obs, "get_logger")
        self.enterContext(logger)

    async def request(self, method, path, payload=None, overrides=(), raw=None):
        body = json.dumps(payload).encode() if raw is None else raw
        headers = {
            b"host": b"127.0.0.1:18766", b"origin": b"http://127.0.0.1:18766",
            b"x-codelens-token": server.TOKEN.encode(), b"content-type": b"application/json",
        }
        headers.update(overrides)
        scope = {"type": "http", "http_version": "1.1", "method": method, "scheme": "http",
                 "path": path, "query_string": b"", "headers": list(headers.items()),
                 "server": ("127.0.0.1", 18766), "asgi": {"version": "3.0", "spec_version": "2.4"}}
        sent = []
        received = asyncio.Queue()
        received.put_nowait({"type": "http.request", "body": body, "more_body": False})

        async def send(event):
            sent.append(event)

        await self.app(scope, received.get, send)
        return sent[0]["status"], b"".join(event.get("body", b"") for event in sent)

    async def test_status_docs_and_analysis(self):
        status, body = await self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["token"], server.TOKEN)
        status, body = await self.request("GET", "/openapi.json")
        self.assertIn("requestBody", json.loads(body)["paths"]["/api/analyze"]["post"])
        status, body = await self.request("POST", "/api/analyze", self.payload)
        self.assertEqual(json.loads(body)["summary"]["parsed"], 1)

    async def test_project_history_endpoints_and_review_archive(self):
        directory = self.enterContext(TemporaryDirectory())
        history = asgi.HistoryStore(Path(directory) / "history.sqlite3")
        self.app = asgi.create_app(self.store, history)
        status, body = await self.request("GET", "/api/status")
        self.assertIn("project-history", json.loads(body)["capabilities"])
        status, body = await self.request("POST", "/api/analyze", {**self.payload, "history_project": None})
        self.assertEqual(status, 200)
        recorded = json.loads(body)["history"]
        project = {"project_id": recorded["project_id"], "analysis_id": recorded["analysis_id"]}
        review = {**self.payload, "history_project": project["project_id"], "history_run": project["analysis_id"],
                  "provider": {"base_url": "https://model.invalid", "model": "mock"}}
        model = ('{"logic":"用途","design":"设计","risks":"风险"}', False)
        with patch.object(server.explanation, "_chat", return_value=model):
            status, body = await self.request("POST", "/api/review", review)
        self.assertEqual(status, 200)
        output = json.loads(body.splitlines()[-1])["result"]
        _, body = await self.request("POST", "/api/review/cached", review)
        self.assertEqual(json.loads(body)["result"], output)
        _, body = await self.request("POST", "/api/history/projects", {})
        self.assertEqual(json.loads(body)[0]["runs"], 1)
        _, body = await self.request("POST", "/api/history/runs", project)
        self.assertEqual(json.loads(body)[0]["ai_status"], "done")
        _, body = await self.request("POST", "/api/history/detail", project)
        self.assertEqual(json.loads(body)["ai"], output)
        _, body = await self.request("POST", "/api/history/delete", project)
        self.assertTrue(json.loads(body)["deleted"])
        status, _ = await self.request("POST", "/api/history/detail", project)
        self.assertEqual(status, 400)

    def test_history_archive_failure_is_logged(self):
        with patch.object(asgi.HistoryStore, "save_review", side_effect=sqlite3.OperationalError), \
                patch.object(asgi.obs, "log_event") as log:
            asgi._review_status(asgi.HistoryStore(), {"history_project": "project"}, {"history_run": 1}, "done")
        self.assertEqual(log.call_args.args[2], "history.write_failed")

    async def test_invalid_inputs_preserve_status_and_request_id(self):
        cases = [
            (403, {b"host": b"example.invalid"}, b"{}"),
            (403, {b"origin": b"http://example.invalid"}, b"{}"),
            (415, {b"content-type": b"text/plain"}, b"{}"),
            (413, {b"content-length": b"99999999"}, b"{}"),
            (413, {}, b""),
            (400, {}, b"{"),
            (400, {}, b"{}"),
        ]
        for expected, headers, raw in cases:
            with self.subTest(expected=expected, headers=headers):
                status, body = await self.request("POST", "/api/analyze", overrides=headers, raw=raw)
                self.assertEqual(status, expected)
                self.assertRegex(json.loads(body)["request_id"], r"^[0-9a-f]{8}$")
        with patch.object(server, "MAX_BODY", 2):
            self.assertEqual((await self.request("POST", "/api/analyze", raw=b"123"))[0], 413)

    async def test_cached_and_streamed_reviews_use_sqlite_store(self):
        result = {"scope": "file"}
        with patch.object(server.explanation, "cached_review", return_value=result) as cached:
            _, body = await self.request("POST", "/api/review/cached", self.payload)
            self.assertEqual(json.loads(body), {"result": result})
            cached.assert_called_once_with(self.payload, self.store)
        with patch.object(server.explanation, "review", return_value=result) as review:
            status, body = await self.request("POST", "/api/review", self.payload)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), {"type": "result", "result": result})
            self.assertIs(review.call_args.kwargs["store"], self.store)
        _, body = await self.request("POST", "/api/review", {})
        self.assertEqual(json.loads(body)["type"], "error")

    async def test_explain_and_skill_routes(self):
        status, _ = await self.request("GET", "/api/ai/status")
        self.assertEqual(status, 200)
        with patch.object(server.explanation, "explain", return_value={"text": "demo"}) as explain:
            payload = {**self.payload, "target": {"scope": "project"}}
            status, body = await self.request("POST", "/api/explain", payload)
            self.assertEqual((status, json.loads(body)), (200, {"text": "demo"}))
            explain.assert_called_once_with(payload)
        status, body = await self.request("POST", "/api/ai", {**self.payload, "skills": ["unknown"]})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "refused")

    async def test_explain_and_internal_errors_preserve_status(self):
        payload = {**self.payload, "target": {"scope": "project"}}
        for exception, expected in [(server.explanation.ExplanationError("offline"), 502),
                                    (TimeoutError(), 408), (RuntimeError("private"), 500)]:
            with self.subTest(expected=expected), patch.object(server.explanation, "explain", side_effect=exception):
                status, body = await self.request("POST", "/api/explain", payload)
                self.assertEqual(status, expected)
                self.assertNotIn(b"private", body)

    async def test_review_worker_stops_when_stream_is_closed(self):
        for failure in (None, ValueError("model refused")):
            with self.subTest(failure=failure):
                await self.verify_closed_stream(failure)

    async def verify_closed_stream(self, failure):
        started = asyncio.Event()
        finished = asyncio.Event()
        release = threading.Event()
        loop = asyncio.get_running_loop()

        def review(payload, progress, store):
            loop.call_soon_threadsafe(started.set)
            progress({"type": "progress", "stage": "read", "done": 0, "total": 1})
            release.wait(timeout=2)
            try:
                if failure:
                    raise failure
                progress({"type": "progress", "stage": "read", "done": 1, "total": 1})
            finally:
                loop.call_soon_threadsafe(finished.set)

        class State:
            request_id = "test"

        class Request:
            state = State()

        with patch.object(server.explanation, "review", side_effect=review):
            stream = asgi._review_stream(Request(), self.payload, self.store)
            self.assertEqual(json.loads(await anext(stream))["type"], "progress")
            self.assertTrue(started.is_set())
            await stream.aclose()
            release.set()
            await asyncio.wait_for(finished.wait(), 3)

    def test_cli_starts_uvicorn_on_loopback(self):
        with patch.object(sys, "argv", ["asgi.py", "--port", "18888", "--no-log-file"]), \
                patch.object(asgi.obs, "configure_logging"), patch.object(asgi.obs, "install_crash_hooks"), \
                patch.object(asgi.uvicorn, "run") as run:
            runpy.run_path(asgi.__file__, run_name="__main__")
        self.assertEqual(run.call_args.kwargs, {
            "host": "127.0.0.1", "port": 18888, "access_log": False, "proxy_headers": False,
        })
