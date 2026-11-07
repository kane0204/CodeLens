"""Exercise the HTTP adapter over in-memory streams, without a listener."""
import io
import json
import runpy
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from backend import server


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.logger = Mock()
        for name in ("get_logger", "configure_logging"):
            configure = patch.object(server.obs, name, return_value=self.logger)
            configure.start()
            self.addCleanup(configure.stop)

    def request(self, method, path, *, payload=None, body=None, headers=None, write_error=None,
                timeout_error=None):
        if body is None:
            body = json.dumps(payload).encode() if method == "POST" else b""
        request_headers = {
            "Host": "localhost:18766",
            "Origin": "http://localhost:18766",
            "X-CodeLens-Token": server.TOKEN,
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(body)),
            **(headers or {}),
        }
        request = f"{method} {path} HTTP/1.1\r\n" + "".join(
            f"{key}: {value}\r\n" for key, value in request_headers.items()
        )
        socket = Mock()
        socket.settimeout.side_effect = timeout_error
        socket.makefile.return_value = io.BytesIO(request.encode() + b"\r\n" + body)
        writes = []

        def send(data):
            writes.append(data)
            if write_error and len(writes) == 2:
                raise write_error

        socket.sendall.side_effect = send
        server.Handler(socket, ("127.0.0.1", 12345), SimpleNamespace(server_port=18766))
        head, content = b"".join(writes).split(b"\r\n\r\n", 1)
        status = int(head.split(b" ", 2)[1])
        return status, head, content

    def test_status_is_loopback_only_and_does_not_cache_token(self):
        status, headers, content = self.request("GET", "/api/status?fresh=1")
        self.assertEqual(status, 200)
        self.assertIn(b"Cache-Control: no-store", headers)
        self.assertIn(b"X-Content-Type-Options: nosniff", headers)
        self.assertEqual(json.loads(content)["token"], server.TOKEN)
        self.assertEqual(self.request("GET", "/api/status", headers={"Host": "remote.invalid"})[0], 403)
        self.assertEqual(self.request("GET", "/missing")[0], 404)
        with patch.object(server.ai_provider, "resolve_provider",
                          return_value=(server.ai_provider.TemplateProvider(), None)):
            data = json.loads(self.request("GET", "/api/ai/status")[2])
        self.assertTrue(data["template_only"])
        self.assertIn("logic-summary", {item["id"] for item in data["skills"]})

    def test_post_rejects_untrusted_and_invalid_requests_before_analysis(self):
        cases = [
            ("/api/analyze", {"Host": "other.invalid"}, b"{}", 403),
            ("/api/analyze", {"Origin": "https://other.invalid"}, b"{}", 403),
            ("/api/analyze", {"X-CodeLens-Token": "incorrect"}, b"{}", 403),
            ("/unknown", {}, b"{}", 404),
            ("/api/analyze", {"Content-Type": "text/plain"}, b"{}", 415),
            ("/api/analyze", {"Content-Length": str(server.MAX_BODY + 1)}, b"{}", 413),
            ("/api/analyze", {}, b"", 413),
            ("/api/analyze", {"Content-Length": "50"}, b"{}", 400),
            ("/api/analyze", {"Content-Length": "bad"}, b"{}", 400),
            ("/api/analyze", {}, b"{", 400),
        ]
        with patch.object(server, "analyze") as analyze:
            for path, headers, body, expected in cases:
                with self.subTest(path=path, headers=headers, body=body):
                    self.assertEqual(self.request("POST", path, headers=headers, body=body)[0], expected)
        analyze.assert_not_called()

    def test_analyze_rejects_non_object_json(self):
        self.assertEqual(self.request("POST", "/api/analyze", payload=[])[0], 400)

    def test_body_read_timeout_is_a_correlated_408(self):
        status, _, content = self.request("POST", "/api/analyze", payload={"files": []},
                                          timeout_error=TimeoutError)
        result = json.loads(content)
        self.assertEqual(status, 408)
        self.assertIn("超时", result["error"])
        self.assertIn(f"request_id={result['request_id']}", self.logger.warning.call_args.args[0])

    def test_dispatch_adds_correlated_500_on_unexpected_get_error(self):
        with patch.object(server.Handler, "handle_get", side_effect=RuntimeError("private details")):
            status, _, content = self.request("GET", "/api/status")
        result = json.loads(content)
        self.assertEqual(status, 500)
        self.assertNotIn("private details", result["error"])
        self.assertRegex(result["request_id"], r"^[0-9a-f]{8}$")
        self.assertIn(f"request_id={result['request_id']}", self.logger.error.call_args.args[0])

    def test_disconnect_is_logged_without_writing_a_second_response(self):
        handler = object.__new__(server.Handler)
        handler.path = "/api/analyze"
        handler.send_data = Mock()
        with patch.object(server, "analyze", side_effect=ConnectionResetError):
            handler.headers = {"Host": "localhost:18766", "Origin": "http://localhost:18766",
                               "X-CodeLens-Token": server.TOKEN, "Content-Type": "application/json",
                               "Content-Length": "2"}
            handler.rfile = io.BytesIO(b"{}")
            handler.server = SimpleNamespace(server_port=18766)
            handler.connection = Mock()
            handler.do_POST()
        handler.send_data.assert_not_called()
        self.assertIn("error=client_disconnect", self.logger.error.call_args.args[0])

    def test_empty_analysis_keeps_empty_status_and_ai_reports_no_source(self):
        status, _, data = self.request("POST", "/api/analyze", payload={"files": []})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["status"], "empty")
        self.assertNotIn("health", json.loads(data))
        status, _, data = self.request("POST", "/api/ai", payload={"skills": ["logic-summary"]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["warnings"][0]["code"], "no-source")

    def test_ai_can_omit_output_text_while_retaining_evidence(self):
        payload = {"skills": ["logic-summary"], "targets": ["function:main.run"],
                   "files": [{"path": "main.py", "content": "def run():\n    return 1\n"}],
                   "options": {"include_text": False}}
        fallback = (server.ai_provider.TemplateProvider(), "provider unavailable")
        with patch.object(server.ai_provider, "resolve_provider", return_value=fallback):
            status, _, data = self.request("POST", "/api/ai", payload=payload)
        self.assertEqual(status, 200)
        result = json.loads(data)
        item, = result["results"]
        self.assertEqual((item["outputs"], item["notes"]), ({}, []))
        self.assertTrue(item["claims"])
        self.assertIn("provider-fallback", {item["code"] for item in result["warnings"]})

    def test_ai_rejects_invalid_skill_types_as_client_errors(self):
        for invalid_skill in ({}, [], 7, None, "missing-skill"):
            with self.subTest(skill=invalid_skill):
                status, _, content = self.request("POST", "/api/ai", payload={"skills": [invalid_skill]})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(content)["error"]["code"], "refused")

    def test_ai_rejects_invalid_payload_targets_and_options(self):
        base = {"skills": ["logic-summary"]}
        for payload in ([], {}, {**base, "targets": [1]},
                        {**base, "targets": ["file:a.py"] * (server.MAX_AI_TARGETS + 1)},
                        {**base, "options": ["invalid"]}):
            with self.subTest(payload=payload):
                status, _, content = self.request("POST", "/api/ai", payload=payload)
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(content)["error"]["code"], "refused")

    def test_analyze_and_explain_dispatch_to_their_services(self):
        request = {"files": [{"path": "main.py", "content": "def run():\n    return 1\n"}]}
        status, _, data = self.request("POST", "/api/analyze", payload=request)
        self.assertEqual(status, 200)
        output = json.loads(data)
        self.assertEqual(output["status"], "complete")
        self.assertEqual(output["functions"][0]["id"], "main.run")
        self.assertEqual(output["health"]["score"], 100)
        with patch.object(server.explanation, "explain", return_value={"text": "说明"}) as explain:
            status, _, data = self.request("POST", "/api/explain", payload=request)
        explain.assert_called_once_with(request)
        self.assertEqual((status, json.loads(data)), (200, {"text": "说明"}))

    def test_model_and_internal_errors_keep_their_response_contract(self):
        cases = [
            ("/api/explain", server.explanation.ExplanationError("timeout"), 502, "timeout"),
            ("/api/analyze", RuntimeError("private details"), 500, "分析失败"),
            ("/api/ai", RuntimeError("private details"), 500, "internal"),
        ]
        for path, error, expected_status, message in cases:
            with self.subTest(path=path), patch.object(server, "analyze", side_effect=error), \
                    patch.object(server.explanation, "explain", side_effect=error):
                status, _, data = self.request("POST", path, payload={"skills": ["logic-summary"]})
                self.assertEqual(status, expected_status)
                self.assertIn(message, data.decode())
                self.assertNotIn("private details", data.decode())

    def test_review_streams_progress_then_result_and_survives_disconnect(self):
        def review(payload, progress):
            progress({"type": "progress", "label": "读取源码"})
            return {"project": payload["project"]}

        payload = {"project": "demo"}
        with patch.object(server.explanation, "review", side_effect=review) as service:
            status, headers, body = self.request("POST", "/api/review", payload=payload)
            _, _, partial = self.request("POST", "/api/review", payload=payload, write_error=BrokenPipeError())
        self.assertEqual(status, 200)
        self.assertIn(b"application/x-ndjson", headers)
        self.assertEqual([json.loads(row) for row in body.splitlines()], [
            {"type": "progress", "label": "读取源码"}, {"type": "result", "result": payload},
        ])
        self.assertEqual(json.loads(partial)["type"], "progress")
        self.assertEqual(service.call_count, 2)

    def test_review_stream_emits_structured_errors(self):
        for error, expected in [
            (server.explanation.ExplanationError("timeout"), "timeout"),
            (ValueError("invalid input"), "invalid input"),
            (RuntimeError("private details"), "AI 审查失败；未生成替代结论"),
        ]:
            with self.subTest(error=error), patch.object(server.explanation, "review", side_effect=error):
                status, _, body = self.request("POST", "/api/review", payload={})
                self.assertEqual(status, 200)
                event = json.loads(body)
                self.assertEqual((event["type"], event["error"]), ("error", expected))
                self.assertRegex(event["error_id"], r"^[0-9a-f]{8}$")
                self.assertIn(f"request_id={event['error_id']}", self.logger.info.call_args.args[0])

    def test_broken_pipe_does_not_retry_or_reclassify_the_response(self):
        status, _, _ = self.request("GET", "/api/status", write_error=BrokenPipeError())
        self.assertEqual(status, 200)
        with patch.object(server.explanation, "review", side_effect=ConnectionResetError):
            status, _, body = self.request("POST", "/api/review", payload={})
        self.assertEqual((status, body), (200, b""))

    def test_plain_analysis_validation_error_uses_non_ai_error_shape(self):
        invalid = server.ai_contract.SkillError("refused", "invalid target")
        with patch.object(server, "analyze", side_effect=invalid):
            status, _, data = self.request("POST", "/api/analyze", payload={"files": []})
        body = json.loads(data)
        self.assertEqual((status, body["error"]), (400, str(invalid)))
        self.assertRegex(body["request_id"], r"^[0-9a-f]{8}$")
        self.assertIn(f"request_id={body['request_id']}", self.logger.warning.call_args.args[0])

    def test_merge_extra_rebuilds_missing_configuration_without_mutating_input(self):
        result = {"files": [], "config": None}
        merged, _ = server.merge_extra(result)
        self.assertEqual(set(merged["config"]["rules"]), set(server.EXTRA_RULE_IDS))
        self.assertIsNone(result["config"])

    def test_cli_binds_loopback_and_closes_server_on_interrupt(self):
        listener = Mock(server_port=12345)
        listener.serve_forever.side_effect = KeyboardInterrupt
        with patch.object(sys, "argv", ["server", "--port", "12345"]), \
                patch.object(server, "ThreadingHTTPServer", return_value=listener) as create, \
                redirect_stdout(io.StringIO()) as output:
            server.main()
        create.assert_called_once_with(("127.0.0.1", 12345), server.Handler)
        listener.server_close.assert_called_once()
        self.assertIn("127.0.0.1:12345", output.getvalue())

    def test_cli_closes_server_when_serving_fails(self):
        listener = Mock(server_port=12345)
        listener.serve_forever.side_effect = RuntimeError("serve failed")
        with patch.object(sys, "argv", ["server"]), patch.object(
                server, "ThreadingHTTPServer", return_value=listener), redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "serve failed"):
                server.main()
        listener.server_close.assert_called_once()

    def test_script_entrypoint_reports_bind_failure(self):
        source = Path(server.__file__).resolve()
        base = str(source.parents[1])
        path = [entry for entry in sys.path if entry != base]
        with patch.object(sys, "path", path), patch.object(sys, "argv", ["server", "--port", "9876"]), \
                patch("http.server.ThreadingHTTPServer", side_effect=OSError("in use")), \
                self.assertRaisesRegex(SystemExit, "9876"):
            runpy.run_path(str(source), run_name="__main__")

    def test_cli_rejects_unsupported_python_before_binding(self):
        with patch.object(sys, "argv", ["server"]), patch.object(sys, "version_info", (3, 10)), \
                patch.object(server, "ThreadingHTTPServer") as create, \
                self.assertRaisesRegex(SystemExit, "Python 3.11"):
            server.main()
        create.assert_not_called()
