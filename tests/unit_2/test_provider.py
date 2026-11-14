"""Unit tests for model configuration, transport, and skill fallback."""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from ai import provider, runner
from core_engine.engine import analyze
from core_engine.ir import build_index


class ModelProviderTests(unittest.TestCase):
    def setUp(self):
        self.endpoint = "https://model.invalid/v1/chat/completions"
        self.http = provider.HttpProvider(self.endpoint, "unit-model", "fake-key", timeout=3)
        self.skill = SimpleNamespace(id="logic-summary", prompt_version="1", prompt=lambda ctx: ctx["text"])
        self.ctx = {"ref": "function:main.run", "text": "静态事实"}

    def test_selects_template_unless_http_is_configured_and_allowed(self):
        settings = {provider.ENV_ENDPOINT: self.endpoint, provider.ENV_MODEL: "unit-model"}
        with patch.dict(os.environ, settings, clear=True):
            self.assertIsInstance(provider.resolve_provider()[0], provider.TemplateProvider)
            os.environ[provider.ENV_KEY] = "fake-key"
            os.environ[provider.ENV_TIMEOUT] = "invalid"
            http, _ = provider.resolve_provider()
            self.assertIsInstance(http, provider.HttpProvider)
            self.assertEqual(http.timeout, provider.DEFAULT_TIMEOUT)
            self.assertIsInstance(provider.resolve_provider(allow_http=False)[0], provider.TemplateProvider)
            self.assertNotIn("fake-key", json.dumps(http.describe()))

    def test_base_provider_is_unavailable_and_requires_a_transport(self):
        base = provider.Provider()
        self.assertFalse(base.describe()["available"])
        with self.assertRaises(NotImplementedError):
            base.produce(self.skill, self.ctx)

    def test_http_provider_sends_request_and_adds_provenance(self):
        message = {"claims": [], "outputs": {"headline": "示例"}}
        envelope = {"choices": [{"message": {"content": json.dumps(message)}}]}
        with patch("ai.provider.urllib.request.urlopen",
                   return_value=io.BytesIO(json.dumps(envelope).encode())) as open_url:
            raw, diagnostics = self.http.produce(self.skill, self.ctx)

        request, = open_url.call_args.args
        self.assertEqual(open_url.call_args.kwargs, {"timeout": 3.0})
        self.assertEqual((request.full_url, request.get_method()), (self.endpoint, "POST"))
        self.assertEqual(request.get_header("Authorization"), "Bearer fake-key")
        payload = json.loads(request.data)
        self.assertEqual(payload["model"], "unit-model")
        self.assertEqual(payload["messages"][-1], {"role": "user", "content": "静态事实"})
        self.assertEqual(raw, {
            **message, "skill": self.skill.id, "target": self.ctx["ref"],
            "generator": {"provider": self.http.id, "model": "unit-model", "prompt_version": "1"},
        })
        self.assertEqual(diagnostics, {"attempts": 1, "provider": self.http.id})

    def test_http_provider_reports_malformed_responses(self):
        for body in (b"invalid JSON", b"{}", b'{"choices": []}'):
            with self.subTest(body=body), patch("ai.provider.urllib.request.urlopen",
                                               return_value=io.BytesIO(body)):
                with self.assertRaises(provider.ProviderError):
                    self.http.produce(self.skill, self.ctx)

    def test_incomplete_configuration_fails_before_network_request(self):
        with patch.dict(os.environ, clear=True), patch("ai.provider.urllib.request.urlopen") as open_url:
            incomplete = provider.HttpProvider(self.endpoint, "unit-model")
            self.assertFalse(incomplete.available())
            with self.assertRaises(provider.ProviderError):
                incomplete.produce(self.skill, self.ctx)
        open_url.assert_not_called()

    def test_runner_falls_back_to_template_with_resolvable_evidence(self):
        result = analyze({"files": [
            {"path": "main.py", "content": "def run(x):\n    if x:\n        return 1\n    return 0\n"},
        ]})
        env = runner.build_env(build_index(result))
        env["ensure_trees"]()
        service = runner.Runner(env, provider=self.http, cache=runner.Cache())
        with patch("ai.provider.urllib.request.urlopen", side_effect=URLError("offline")) as open_url:
            outcome = service.run(["logic-summary"], targets=[self.ctx["ref"]])

        open_url.assert_called_once()
        item, = outcome["results"]
        self.assertEqual(item["status"], "ok")
        self.assertEqual(item["generator"]["provider"], provider.TemplateProvider.id)
        self.assertIn("offline", item["diagnostics"]["fallback"])
        self.assertTrue(item["claims"])
        citations = outcome["summary"]["citations"]
        self.assertGreater(citations["count"], 0)
        self.assertEqual(citations["resolved"], citations["count"])
