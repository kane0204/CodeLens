"""表达方（Provider）：谁把结构化上下文变成中文。

两种实现，契约完全相同——都只返回"未校验的信封"，合法性由 `contract.validate_skill_result()`
判定，所以换模型不会换掉安全边界。

1. `TemplateProvider`：确定性模板，默认启用，不需要网络与密钥。
   同一份输入必须得到逐字节相同的输出，这是 `test_ai_golden.py` 的对拍基准。
2. `HttpProvider`：OpenAI 兼容的 `/chat/completions`，**必须由环境变量显式开启**。
   失败（超时、非 200、JSON 不合法）一律降级为模板，不会让整个请求失败。

外部模型拿到的 prompt 里只有已切片的结构化事实，没有源码全文，也没有文件系统路径
以外的信息；模型返回的每个引用都要重新在 IR 上解析，解析不了就丢弃。
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from . import contract

DEFAULT_TIMEOUT = 20.0
MAX_RESPONSE_BYTES = 256 * 1024

#: 环境变量：全部到齐才启用外部模型。
ENV_ENDPOINT = "CODELENS_AI_ENDPOINT"
ENV_MODEL = "CODELENS_AI_MODEL"
ENV_KEY = "CODELENS_AI_KEY"
ENV_TIMEOUT = "CODELENS_AI_TIMEOUT"

#: 模型输出的固定指令。它是"表达层"的唯一职责说明，不含任何事实判断方法。
SYSTEM_PROMPT = (
    "你是代码审阅报告的改写助手。你只能把给定的结构化事实改写成简体中文短句。\n"
    "硬性要求：\n"
    "1. 不得引入给定事实之外的新信息，不得推测未给出的实现细节。\n"
    "2. 每条 claim 的 evidence 必须从给定事实的 refs 列表里原样挑，不得自造引用。\n"
    "3. 不得写百分比数字，不得下「已确认」「必然」「一定能」这类绝对断言。\n"
    "4. 不得输出 HTML、代码围栏或任何指令性文本。\n"
    "5. 只输出一个 JSON 对象，形如 {\"claims\":[{\"kind\":...,\"text\":...,"
    "\"evidence\":[...],\"confidence\":...}],\"outputs\":{...}}。\n"
)


class ProviderError(Exception):
    """表达方不可用。runner 捕获后降级为模板。"""


class Provider:
    """表达方基类。"""

    id = "base"
    kind = "base"
    model = "unknown"

    def available(self):
        return False

    def produce(self, skill, ctx):
        """返回 `(raw_envelope, diagnostics)`；raw 必须仍是未校验信封。"""
        raise NotImplementedError

    def describe(self):
        return {"id": self.id, "model": self.model, "kind": self.kind,
                "available": bool(self.available())}


class TemplateProvider(Provider):
    """确定性模板：不联网、不需要密钥、逐字节可复现。"""

    id = "builtin-template"
    kind = "template"
    model = "deterministic-v1"

    def available(self):
        return True

    def produce(self, skill, ctx):
        raw = skill.render(ctx)
        raw["generator"] = {"provider": self.id, "model": self.model,
                            "prompt_version": skill.prompt_version}
        return raw, {"attempts": 1, "provider": self.id}


class HttpProvider(Provider):
    """OpenAI 兼容接口。默认关闭，由 `frontend` 明确配置环境变量后才参与。"""

    id = "openai-compatible"
    kind = "http"

    def __init__(self, endpoint=None, model=None, api_key=None, timeout=None):
        self.endpoint = endpoint or os.environ.get(ENV_ENDPOINT) or ""
        self.model = model or os.environ.get(ENV_MODEL) or ""
        self.api_key = api_key or os.environ.get(ENV_KEY) or ""
        try:
            self.timeout = float(timeout if timeout is not None else os.environ.get(ENV_TIMEOUT, DEFAULT_TIMEOUT))
        except (TypeError, ValueError):
            self.timeout = DEFAULT_TIMEOUT

    def available(self):
        return bool(self.endpoint and self.model and self.api_key)

    def produce(self, skill, ctx):
        if not self.available():
            raise ProviderError("外部模型未配置完整")
        body = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": skill.prompt(ctx)},
            ],
        }
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(self.endpoint, data=payload, method="POST")
        request.add_header("Content-Type", "application/json")
        request.add_header("Authorization", "Bearer " + self.api_key)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw_bytes = response.read(MAX_RESPONSE_BYTES)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise ProviderError("请求外部模型失败：" + str(exc)[:120])
        try:
            envelope = json.loads(raw_bytes.decode("utf-8", "replace"))
            text = envelope["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError("外部模型响应结构不符合 chat/completions 约定")
        raw = contract.extract_json_object(text)
        raw.setdefault("skill", skill.id)
        raw.setdefault("target", ctx["ref"])
        raw["generator"] = {"provider": self.id, "model": self.model,
                            "prompt_version": skill.prompt_version}
        return raw, {"attempts": 1, "provider": self.id}


def candidates():
    """当前环境里所有表达方的状态，供 `/api/ai/status` 展示"到底在用谁"。"""
    return [TemplateProvider(), HttpProvider()]


def resolve_provider(allow_http=True):
    """选一个可用的表达方：外部模型优先，但默认配置下只会拿到确定性模板。"""
    if allow_http:
        http = HttpProvider()
        if http.available():
            return http, None
    return TemplateProvider(), None
