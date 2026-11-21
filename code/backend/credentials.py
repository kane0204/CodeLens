"""Persist the model API key in the operating system's credential store."""
from __future__ import annotations

import keyring

SERVICE_NAME = "CodeLens"
ACCOUNT_NAME = "llm-api-key"
MAX_KEY_CHARS = 8192
BACKEND_LABELS = (
    ("keyring.backends.Windows", "Windows Credential Manager"),
    ("keyring.backends.macOS", "macOS Keychain"),
    ("keyring.backends.SecretService", "Linux Secret Service"),
)


class CredentialError(RuntimeError):
    """The operating-system credential store could not complete the request."""


class CredentialStore:
    def __init__(self, service=SERVICE_NAME, account=ACCOUNT_NAME, backend=None):
        self.service = service
        self.account = account
        self._backend_override = backend

    def _backend(self):
        backend = self._backend_override or keyring
        if backend is None:
            raise CredentialError("系统凭据组件未安装，请重新运行 CodeLens 启动脚本。")
        if backend is keyring:
            backend = backend.get_keyring()
        return backend

    def _backend_name(self):
        try:
            backend = self._backend()
            module = type(backend).__module__
            return next((label for prefix, label in BACKEND_LABELS if module.startswith(prefix)),
                        type(backend).__name__)
        except CredentialError:
            return "unavailable"

    def available(self):
        try:
            return getattr(self._backend(), "priority", 1) > 0
        except CredentialError:
            return False

    def status(self):
        backend = self._backend_name()
        if not self.available():
            return {
                "available": False,
                "configured": False,
                "backend": backend,
            }
        try:
            return {
                "available": True,
                "configured": bool(self._password()),
                "backend": backend,
            }
        except Exception:
            return {
                "available": False,
                "configured": False,
                "backend": backend,
            }

    def _password(self):
        try:
            return self._backend().get_password(self.service, self.account)
        except CredentialError:
            raise
        except Exception as exc:
            raise CredentialError("无法读取系统凭据库，请检查当前系统账户的凭据服务。") from exc

    def get_api_key(self):
        value = self._password()
        return value.strip() if isinstance(value, str) else ""

    def set_api_key(self, value):
        if not isinstance(value, str):
            raise ValueError("API Key 必须是字符串")
        api_key = value.strip()
        if not api_key:
            raise ValueError("API Key 不能为空")
        if len(api_key) > MAX_KEY_CHARS or any(char in api_key for char in "\r\n"):
            raise ValueError("API Key 格式无效")
        try:
            self._backend().set_password(self.service, self.account, api_key)
        except Exception as exc:
            raise CredentialError("无法写入系统凭据库，请检查当前系统账户的凭据服务。") from exc

    def clear_api_key(self):
        if not self.get_api_key():
            return False
        try:
            self._backend().delete_password(self.service, self.account)
        except Exception as exc:
            raise CredentialError("无法清除系统凭据库中的 API Key。") from exc
        return True


def with_stored_api_key(payload, store):
    """Fill an omitted key from the OS vault without exposing it to the browser."""
    if not isinstance(payload, dict):
        return payload
    provider = payload.get("provider")
    if not isinstance(provider, dict) or str(provider.get("api_key") or "").strip():
        return payload
    if not store.available():
        return payload
    api_key = store.get_api_key()
    if not api_key:
        return payload
    return {**payload, "provider": {**provider, "api_key": api_key}}


CREDENTIALS = CredentialStore()
