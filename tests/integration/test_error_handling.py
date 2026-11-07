"""Error responses, correlation ids and log privacy over real HTTP."""
import base64
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "code"))
from backend import observability as obs
from backend import server
from backend.server import Handler


class ErrorHandlingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.log_path = Path(cls.tmp.name) / "api.log"
        obs.reset_for_tests()
        obs.configure_logging("INFO", str(cls.log_path))
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.origin = f"http://127.0.0.1:{cls.http.server_port}"
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        with urllib.request.urlopen(cls.origin + "/api/status", timeout=10) as response:
            cls.token = json.load(response)["token"]

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)
        obs.reset_for_tests()
        cls.tmp.cleanup()

    def request(self, path, raw, token=None):
        req = urllib.request.Request(
            self.origin + path,
            data=raw,
            headers={
                "Content-Type": "application/json",
                "Origin": self.origin,
                "X-CodeLens-Token": self.token if token is None else token,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def post_json(self, path, payload, token=None):
        status, raw = self.request(path, json.dumps(payload).encode(), token)
        return status, json.loads(raw)

    def log_text(self):
        return self.log_path.read_text(encoding="utf-8")

    def test_guard_failure_has_request_id(self):
        status, body = self.post_json("/api/analyze", {}, token="wrong-token")
        self.assertEqual(status, 403)
        self.assertIn("request_id", body)
        self.assertNotEqual(body["request_id"], "-")

    def test_unknown_route_has_request_id(self):
        status, body = self.post_json("/api/does-not-exist", {})
        self.assertEqual(status, 404)
        self.assertIn("request_id", body)

    def test_ai_validation_error_keeps_code_and_adds_id(self):
        status, body = self.post_json("/api/ai", {"skills": ["not-a-skill"]})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "refused")
        self.assertIn("request_id", body)

    def test_malformed_json_returns_400_with_id(self):
        status, raw = self.request("/api/analyze", b"{not-json")
        body = json.loads(raw)
        self.assertEqual(status, 400)
        self.assertIn("request_id", body)

    def test_internal_failure_returns_500_with_id_and_logs_type(self):
        original = server.enrich
        def boom(_payload):
            raise RuntimeError("boom")

        server.enrich = boom
        try:
            status, body = self.post_json("/api/analyze", {"files": []})
        finally:
            server.enrich = original
        self.assertEqual(status, 500)
        self.assertIn("request_id", body)
        text = self.log_text()
        self.assertIn(body["request_id"], text)
        self.assertIn("RuntimeError", text)

    def test_stream_error_event_carries_error_id(self):
        original = server.explanation.review
        def boom(_payload, progress=None):
            raise server.explanation.ExplanationError("review unavailable")

        server.explanation.review = boom
        try:
            status, raw = self.request("/api/review", json.dumps({"files": []}).encode())
        finally:
            server.explanation.review = original
        self.assertEqual(status, 200)  # NDJSON stream; failure is an event, not an HTTP error
        event = json.loads(raw.strip().splitlines()[-1])
        self.assertEqual(event["type"], "error")
        self.assertTrue(event["error_id"])

    def test_logs_never_contain_source_or_project_name(self):
        marker = "SENTINEL_SOURCE_9f2c"
        source = f"x = '{marker}'"
        payload = {
            "project": "SENTINEL_PROJECT_9f2c",
            "files": [{
                "path": "secret_module.py",
                "content_base64": base64.b64encode(source.encode()).decode(),
            }],
        }
        status, _ = self.post_json("/api/analyze", payload)
        self.assertEqual(status, 200)
        text = self.log_text()
        for sensitive in (marker, "SENTINEL_PROJECT_9f2c", "secret_module.py"):
            self.assertNotIn(sensitive, text)
        self.assertIn("path=/api/analyze", text)
        self.assertIn("status=200", text)
        self.assertIn("duration_ms=", text)

    def test_request_log_records_status_duration_and_id(self):
        with urllib.request.urlopen(self.origin + "/api/status", timeout=10) as response:
            self.assertEqual(response.status, 200)
        text = self.log_text()
        self.assertIn("method=GET", text)
        self.assertIn("request_id=", text)
        self.assertIn("duration_ms=", text)
