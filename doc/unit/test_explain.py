"""Unit tests for source slicing and the model transport."""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from ai import explanation, provider


class ExplainTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "project": "demo",
            "provider": {"base_url": "https://model.invalid/v1/", "model": " unit ", "api_key": " fake-key "},
            "files": [
                {"path": "main.py", "content": "from helper import work\n\ndef run():\n    return work()\n"},
                {"path": "helper.py", "content": "def work():\n    return 1\n"},
            ],
            "target": {"file": "main.py", "function": "main.run"},
        }

    def test_explain_sends_only_selected_function_and_resolved_context(self):
        with patch.object(explanation, "_chat", return_value=("第 4 行；[helper.py:L1-L2]", True)) as chat:
            result = explanation.explain(self.payload)
        endpoint, model, key, _, prompt = chat.call_args.args
        self.assertEqual((endpoint, model, key), ("https://model.invalid/v1/chat/completions", "unit", "fake-key"))
        self.assertIn("4:     return work()", prompt)
        self.assertIn("2:     return 1", prompt)
        self.assertNotIn("1: from helper", prompt)
        self.assertEqual((result["file"], result["function"], result["line"], result["end_line"]),
                         ("main.py", "main.run", 3, 4))
        self.assertTrue(result["truncated"])
        self.assertEqual([(c["file"], c["valid"]) for c in result["citations"]],
                         [("main.py", True), ("helper.py", True)])

    def test_explain_rejects_invalid_target_and_oversized_selection_before_model_call(self):
        cases = [
            ({**self.payload, "target": None}, "请选择"),
            ({**self.payload, "target": {"file": "missing.py"}}, "未成功解析"),
            ({**self.payload, "target": {"file": "main.py", "function": "helper.work"}}, "不属于"),
            ({**self.payload, "target": {"file": "main.py"}}, "超过解读上限"),
            ({**self.payload, "files": [], "target": {"scope": "project"}}, "没有成功解析"),
        ]
        with patch.object(explanation, "_chat") as chat, patch.object(explanation, "MAX_SOURCE_CHARS", 10):
            for payload, message in cases:
                with self.subTest(target=payload["target"]), self.assertRaisesRegex(ValueError, message):
                    explanation.explain(payload)
        chat.assert_not_called()

    def test_provider_config_rejects_bad_types_and_unsafe_endpoints(self):
        for payload in (None, {"provider": [1]}, {"provider": {"base_url": 1}},
                        {"provider": {"model": "unit"}},
                        {"provider": {"base_url": "file:///tmp/model", "model": "unit"}},
                        {"provider": {"base_url": "https://user@model.invalid", "model": "unit"}},
                        {"provider": {"base_url": "https://model.invalid?key=1", "model": "unit"}},
                        {"provider": {"base_url": "https://model.invalid", "model": "unit\nother"}}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                explanation.explain(payload)

    def test_project_explanation_batches_source_and_keeps_truncation(self):
        files = [
            {"path": "one.py", "content": "# " + "x" * 500 + "\n"},
            {"path": "two.py", "content": "# " + "y" * 500 + "\n"},
        ]
        payload = {**self.payload, "files": files, "target": {"scope": "project"}}
        output = [("one notes", False), ("two notes", True), ("Combined [two.py:L1]", False)]
        with patch.object(explanation, "MAX_PROJECT_BATCH_CHARS", 1000), \
                patch.object(explanation, "_chat", side_effect=output) as chat:
            result = explanation.explain(payload)
        prompts = [item.args[-1] for item in chat.call_args_list]
        self.assertEqual(len(prompts), 3)
        self.assertIn("one.py", prompts[0])
        self.assertIn("two.py", prompts[1])
        self.assertIn("one notes", prompts[2])
        self.assertIn("two notes", prompts[2])
        self.assertEqual((result["scope"], result["source_files"], result["batch_count"]), ("project", 2, 2))
        self.assertTrue(result["truncated"])
        self.assertTrue(result["citations"][0]["valid"])

    def test_project_explanation_uses_environment_and_one_call_for_small_project(self):
        payload = {**self.payload, "provider": {}, "target": {"scope": "project"}}
        env = {provider.ENV_ENDPOINT: "https://model.invalid/chat/completions", provider.ENV_MODEL: "model-env"}
        with patch.dict(os.environ, env, clear=True), patch.object(explanation, "_chat",
                return_value=("Combined", False)) as chat:
            result = explanation.explain(payload)
        chat.assert_called_once()
        self.assertEqual(chat.call_args.args[:3], (env[provider.ENV_ENDPOINT], "model-env", ""))
        self.assertEqual(result["batch_count"], 1)
        self.assertIn("main.py", chat.call_args.args[-1])
        self.assertIn("helper.py", chat.call_args.args[-1])

    def test_long_source_line_is_split_without_losing_bytes_or_line_numbers(self):
        source = "x" * 1400
        with patch.object(explanation, "MAX_PROJECT_BATCH_CHARS", 1000):
            batches = explanation._project_batches([{"path": "main.js", "source": source}])
        fragments = [line.removeprefix("1: ") for batch in batches for line in batch.splitlines()
                     if line.startswith("1: ")]
        self.assertGreater(len(batches), 1)
        self.assertEqual("".join(fragments), source)
        self.assertTrue(all(len(batch) <= 1000 for batch in batches))

    def test_context_can_be_disabled_or_limited_without_claiming_unsent_lines(self):
        helpers = "\n".join(f"def f{i}():\n    return {i}\n" for i in range(8))
        caller = "import helper\ndef run():\n    return (" + ", ".join(f"helper.f{i}()" for i in range(8)) + ")\n"
        payload = {**self.payload, "files": [
            {"path": "main.py", "content": caller}, {"path": "helper.py", "content": helpers},
        ]}
        with patch.object(explanation, "_chat", return_value=("[helper.py:L1] [helper.py:L22]", False)):
            enabled = explanation.explain(payload)
            disabled = explanation.explain({**payload, "include_context": False})
        self.assertEqual(enabled["omitted_context"], 2)
        self.assertEqual(len(enabled["context"]), 7)
        self.assertEqual([c["valid"] for c in enabled["citations"]], [True, False])
        self.assertEqual(disabled["omitted_context"], 0)
        self.assertEqual(len(disabled["context"]), 1)
        self.assertTrue(all(not c["valid"] for c in disabled["citations"]))

    def test_file_explanation_does_not_send_selected_class_twice(self):
        payload = {**self.payload, "files": [
            {"path": "main.py", "content": "class Worker: pass\n\ndef run():\n    return Worker()\n"},
        ], "target": {"file": "main.py"}}
        with patch.object(explanation, "_chat", return_value=("Combined", False)) as chat:
            result = explanation.explain(payload)
        self.assertEqual(chat.call_args.args[-1].count("1: class Worker: pass"), 1)
        self.assertEqual([row["kind"] for row in result["context"]], ["selected"])


class ModelTransportTests(unittest.TestCase):
    endpoint = "https://model.invalid/v1/chat/completions"

    def test_success_uses_json_and_does_not_follow_redirects(self):
        response = {"choices": [{"message": {"content": "  result  "}, "finish_reason": "length"}]}
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps(response).encode())
        with patch.object(explanation.urllib.request, "build_opener", return_value=opener) as build:
            result = explanation._chat(self.endpoint, "unit", "fake-key", "system", "source")
        self.assertEqual(result, ("result", True))
        handler, = build.call_args.args
        self.assertIsInstance(handler, explanation.NoRedirect)
        request, = opener.open.call_args.args
        self.assertEqual(request.full_url, self.endpoint)
        self.assertEqual(request.get_header("Authorization"), "Bearer fake-key")
        self.assertEqual(json.loads(request.data)["messages"][-1], {"role": "user", "content": "source"})
        self.assertIsNone(handler.redirect_request(request, None, 302, "", {}, "https://other.invalid"))

    def test_http_and_network_errors_omit_private_details(self):
        errors = [
            (HTTPError(self.endpoint, 401, "private data", {}, io.BytesIO(b"fake-key")), "HTTP 401"),
            (URLError("fake-key"), "连接中断"),
        ]
        for error, message in errors:
            with self.subTest(error=error), patch.object(explanation.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                with self.assertRaisesRegex(explanation.ExplanationError, message) as raised:
                    explanation._chat(self.endpoint, "unit", "fake-key", "system", "source")
                self.assertNotIn("fake-key", str(raised.exception))
                self.assertNotIn("private data", str(raised.exception))

    def test_transient_disconnect_retries_without_logging_private_details(self):
        response = {"choices": [{"message": {"content": "recovered"}}]}
        with patch.object(explanation.urllib.request, "build_opener") as build, \
                self.assertLogs("codelens", level="WARNING") as logs:
            opener = build.return_value
            opener.open.side_effect = [URLError(TimeoutError("private data")),
                                       io.BytesIO(json.dumps(response).encode())]
            self.assertEqual(explanation._chat(self.endpoint, "unit", "", "system", "source"),
                             ("recovered", False))
            self.assertEqual(opener.open.call_count, 2)
        self.assertIn("type=TimeoutError", logs.output[0])
        self.assertNotIn("private data", logs.output[0])

    def test_truncated_response_and_tls_eof_can_recover_on_third_attempt(self):
        import http.client
        import ssl

        complete = io.BytesIO(b'{"choices":[{"message":{"content":"recovered"}}]}')
        with patch.object(explanation.urllib.request, "build_opener") as build, \
                patch.object(explanation.time, "sleep") as sleep:
            build.return_value.open.side_effect = [
                http.client.IncompleteRead(b"partial"),
                ssl.SSLEOFError("early EOF"),
                complete,
            ]
            self.assertEqual(explanation._chat(self.endpoint, "unit", "", "system", "source"),
                             ("recovered", False))
        self.assertEqual(build.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_invalid_empty_and_oversized_responses_report_specific_errors(self):
        responses = [
            (b'{"choices":[]}', "格式"),
            (b'{"choices":[{"message":{"content":" "}}]}', "没有返回有效"),
            (b"x" * (explanation.MAX_RESPONSE_BYTES + 1), "响应过大"),
        ]
        for response, message in responses:
            with self.subTest(message=message), patch.object(explanation.urllib.request, "build_opener") as build:
                build.return_value.open.return_value = io.BytesIO(response)
                with self.assertRaisesRegex(explanation.ExplanationError, message):
                    explanation._chat(self.endpoint, "unit", "", "system", "source")
                self.assertIsNone(build.return_value.open.call_args.args[0].get_header("Authorization"))
