"""Unit tests for operating-system credential persistence."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from backend import credentials


class FakeBackend:
    priority = 1

    def __init__(self):
        self.values = {}
        self.fail = ""

    def get_password(self, service, account):
        if self.fail == "get":
            raise RuntimeError("vault locked")
        return self.values.get((service, account))

    def set_password(self, service, account, value):
        if self.fail == "set":
            raise RuntimeError("vault locked")
        self.values[(service, account)] = value

    def delete_password(self, service, account):
        if self.fail == "delete":
            raise RuntimeError("vault locked")
        self.values.pop((service, account), None)


class CredentialStoreTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend()
        self.store = credentials.CredentialStore(backend=self.backend)

    def test_round_trips_key_and_reports_backend_status(self):
        self.assertEqual(self.store.status(), {
            "available": True, "configured": False, "backend": "FakeBackend",
        })
        self.store.set_api_key("  fake-key  ")
        self.assertEqual(self.store.get_api_key(), "fake-key")
        self.assertTrue(self.store.status()["configured"])
        self.assertTrue(self.store.clear_api_key())
        self.assertFalse(self.store.clear_api_key())
        self.assertFalse(self.store.status()["configured"])

    def test_validates_keys_before_touching_the_vault(self):
        for value, message in [
            (None, "字符串"),
            ("", "不能为空"),
            ("line\nbreak", "格式无效"),
            ("x" * (credentials.MAX_KEY_CHARS + 1), "格式无效"),
        ]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, message):
                self.store.set_api_key(value)

    def test_degrades_when_the_platform_vault_is_unavailable(self):
        class DisabledBackend(FakeBackend):
            priority = 0

        disabled = credentials.CredentialStore(backend=DisabledBackend())
        self.assertFalse(disabled.available())
        self.assertEqual(disabled.status(), {
            "available": False, "configured": False, "backend": "DisabledBackend",
        })
        with patch.object(credentials, "keyring", None):
            missing = credentials.CredentialStore()
            self.assertFalse(missing.available())
            self.assertEqual(missing.status()["backend"], "unavailable")
            with self.assertRaisesRegex(credentials.CredentialError, r"未安装"):
                missing.get_api_key()

    def test_vault_failures_become_actionable_errors(self):
        self.backend.fail = "get"
        self.assertEqual(self.store.status(), {
            "available": False, "configured": False, "backend": "FakeBackend",
        })
        for operation, action in [
            ("get", lambda: self.store.get_api_key()),
            ("set", lambda: self.store.set_api_key("fake-key")),
        ]:
            with self.subTest(operation=operation):
                self.backend.fail = operation
                with self.assertRaises(credentials.CredentialError):
                    action()
        self.backend.fail = ""
        self.store.set_api_key("fake-key")
        self.backend.fail = "delete"
        with self.assertRaisesRegex(credentials.CredentialError, r"清除"):
            self.store.clear_api_key()

    def test_status_hides_vault_names_when_backend_construction_fails(self):
        with patch.object(self.store, "_backend", side_effect=credentials.CredentialError("offline")):
            self.assertEqual(self.store._backend_name(), "unavailable")
            self.assertFalse(self.store.available())
            self.assertEqual(self.store.status(), {
                "available": False, "configured": False, "backend": "unavailable",
            })


class StoredPayloadTests(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend()
        self.store = credentials.CredentialStore(backend=self.backend)

    def test_only_fills_an_omitted_key_and_never_overrides_request_values(self):
        payload = {"provider": {"base_url": "https://model.invalid", "model": "unit", "api_key": ""}}
        self.assertEqual(credentials.with_stored_api_key(payload, self.store), payload)
        self.store.set_api_key("stored-key")
        filled = credentials.with_stored_api_key(payload, self.store)
        self.assertEqual(filled["provider"]["api_key"], "stored-key")
        explicit = {"provider": {**payload["provider"], "api_key": "request-key"}}
        self.assertEqual(credentials.with_stored_api_key(explicit, self.store), explicit)

    def test_leaves_unrelated_or_non_object_payloads_unchanged(self):
        for payload in (None, {}, {"provider": []}):
            with self.subTest(payload=payload):
                self.assertEqual(credentials.with_stored_api_key(payload, self.store), payload)
        with patch.object(self.store, "available", return_value=False):
            payload = {"provider": {"api_key": ""}}
            self.assertEqual(credentials.with_stored_api_key(payload, self.store), payload)


if __name__ == "__main__":
    unittest.main()
