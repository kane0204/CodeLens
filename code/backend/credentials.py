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
    """使用固定服务名和账户名定位系统凭据。状态接口只给出可用性与配置标记。"""

    def __init__(self, service=SERVICE_NAME, account=ACCOUNT_NAME, backend=None):
        self.service = service
        self.account = account
        self._backend_override = backend

    def _backend(self):
        backend = keyring if self._backend_override is None else self._backend_override
        if backend is None:
            raise CredentialError("系统凭据组件未安装，请重新运行 CodeLens 启动脚本。")
        if backend is keyring:
            backend = backend.get_keyring()
        return backend

    def _backend_name(self, backend=None):
        try:
            if backend is None:
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
        """同一次状态查询复用同一个凭据后端，且不把 Key 返回给工作台。"""
        name = "unavailable"
        try:
            backend = self._backend()
            name = self._backend_name(backend)
            available = getattr(backend, "priority", 1) > 0
            configured = available and bool(backend.get_password(self.service, self.account))
        except Exception:
            available = configured = False
        return {"available": available, "configured": configured, "backend": name}

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
        """只保存有效的单行 Key，确保它也可作为 HTTP 请求头的值。"""
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
    # 仅复制需要补写的两层，调用者持有的原始请求不会被写入系统 Key。
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
