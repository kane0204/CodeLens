"""AI 表达层契约：SkillResult 信封、证据引用校验、三层 schema 校验。

本模块是 AI 层与事实层之间唯一的接口约定，三条硬规则都在这里落地：

1. **事实层与表达层分离**：静态分析与规则引擎产出可复算的事实（`code/core_engine/`）；
   AI 只能填"表达槽位"，不得新增事实、不得新增 finding、不得修改任何 id。
2. **每条结论必须挂证据**：`claims[].evidence` 里的每个引用都要能被 `ir.Index.resolve()`
   解析；解析不到就整条丢弃并记入 `dropped`，绝不让"看起来很对"的文本留下。
3. **默认可用**：没有模型时由各 skill 的确定性模板产出同样的信封结构，
   因此本模块不依赖任何第三方库，也不依赖网络。

模块不导入 `core_engine`，避免循环依赖；引用解析由调用方注入（鸭子类型，
只要能被 `resolve(ref)` 调用并返回 `{"ok": bool, "error": str}`）。
"""
from __future__ import annotations

import json
import re

SCHEMA_VERSION = "1.0"

#: 已注册的 skill 与内容版本。改 prompt 或改输出结构都必须同时升版本号，
#: 因为它参与缓存 key，升版本号等于让旧缓存自然失效。
SKILLS = {
    "logic-summary": {"version": "1.0.0", "title": "代码逻辑总结"},
    "class-node-name": {"version": "1.0.0", "title": "类图节点名"},
    "ai-risk-review": {"version": "1.0.0", "title": "AI 特有风险审查"},
    "solid-review": {"version": "1.0.0", "title": "SOLID 复核"},
}

#: 信封状态。`need_more` 只能由"单个子任务内部"抛出，用来申请补一次上下文，
#: 不允许用它触发全局重新规划（外层 DAG 固定）。
STATUSES = ("ok", "insufficient_evidence", "need_more", "refused")

CONFIDENCES = ("high", "medium", "low")

CLAIM_KINDS = (
    "responsibility",  # 一句话职责
    "step",            # 语句轨迹的人话分组
    "branch",          # 分支/异常路径
    "side_effect",     # 副作用（IO、写文件、改全局）
    "advice",          # 复核建议
    "naming",          # 命名理由
)

MAX_CLAIM_CHARS = 240
MAX_EVIDENCE_PER_CLAIM = 8
MAX_CLAIMS_PER_RESULT = 24
MAX_NOTES = 8
MAX_NOTE_CHARS = 200

#: 表达层禁写规则。命中即丢弃该条 claim，原因写进 dropped。
BANNED_PATTERNS = (
    (re.compile(r"\d+(?:\.\d+)?\s?%"), "不得断言百分比数值：表达层不产出量化结论"),
    (re.compile(r"(已确认|必然|一定能|确定存在|可以断定|毫无疑问|百分百)"), "不得下绝对断言：AI 输出只是解释"),
    (re.compile(r"<[A-Za-z/!]"), "不得输出 HTML 标签"),
    (re.compile(r"```"), "不得在正文中使用代码围栏"),
    (re.compile(r"(忽略以上|ignore (?:all|previous) instructions)", re.I), "不得携带指令注入文本"),
)

#: 规则编号写法。允许提到的规则必须出现在 allowed_rule_ids 里。
RULE_TOKEN = re.compile(r"(?<![A-Za-z0-9])(?:[A-Z]{1,5}-\d{2,3}|A[1-8])(?![A-Za-z0-9])")


class SkillError(Exception):
    """表达层可恢复错误。`kind` 决定 runner 如何降级。"""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind if kind in STATUSES else "insufficient_evidence"

    def __str__(self):
        return "{}: {}".format(self.kind, self.args[0] if self.args else "")


def canonical_json(value):
    """稳定序列化：缓存 key、golden 对拍、测试比较都用它，保证逐字节可比。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def short_hash(value):
    import hashlib

    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def claim(text, evidence, kind="step", confidence="medium"):
    """构造一条 claim。只做形状规整，真正的合法性在 validate 里判定。"""
    return {
        "kind": kind,
        "text": str(text or "").strip(),
        "evidence": list(evidence or []),
        "confidence": confidence,
    }


def new_result(skill, target, status="ok", claims=None, outputs=None, generator=None,
               notes=None, diagnostics=None, dropped=None):
    """构造未校验的信封。字段顺序固定，方便 golden 对拍直接比对文本。"""
    meta = SKILLS.get(skill, {"version": "0.0.0"})
    return {
        "schema_version": SCHEMA_VERSION,
        "skill": skill,
        "skill_version": meta["version"],
        "target": target,
        "status": status,
        "claims": list(claims or []),
        "outputs": dict(outputs or {}),
        "citations": {"count": 0, "resolved": 0, "unresolved": 0, "coverage": 0.0},
        "dropped": list(dropped or []),
        "generator": dict(generator or {"provider": "builtin-template", "model": "deterministic-v1",
                                        "prompt_version": meta["version"]}),
        "cache_key": None,
        "notes": list(notes or []),
        "diagnostics": dict(diagnostics or {}),
    }


def extract_json_object(text):
    """从模型输出里取出第一个 JSON 对象；容忍 ```json 围栏与前后废话。

    解析失败一律抛 SkillError，由 runner 降级为 insufficient_evidence，
    绝不用正则"猜"出半截结果。
    """
    if not isinstance(text, str) or not text.strip():
        raise SkillError("insufficient_evidence", "模型没有返回内容")
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", raw, re.S)
    if fenced:
        raw = fenced.group(1).strip()
    start = raw.find("{")
    if start < 0:
        raise SkillError("insufficient_evidence", "模型输出不含 JSON 对象")
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(raw)):
        char = raw[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    value = json.loads(raw[start:index + 1])
                except ValueError as exc:
                    raise SkillError("insufficient_evidence", "模型输出不是合法 JSON：" + str(exc)[:80])
                if not isinstance(value, dict):
                    raise SkillError("insufficient_evidence", "模型输出的 JSON 不是对象")
                return value
    raise SkillError("insufficient_evidence", "模型输出的 JSON 不完整")


def _check_banned(text):
    for pattern, reason in BANNED_PATTERNS:
        if pattern.search(text):
            return reason
    return None


def _check_rule_tokens(text, allowed_rule_ids):
    """规则编号只能来自本次分析真的产出的规则。

    规则号有两种写法：完整的 `A8-DEFENSIVE`，以及它的家族前缀 `A8`。前缀也算合法，
    否则"引用 A8-DEFENSIVE"这句话会因为多匹配出一个 `A8` 而被整条丢弃。
    """
    allowed = set(allowed_rule_ids or ())
    allowed_prefixes = set()
    for rule_id in allowed:
        head = rule_id.split("-", 1)[0]
        if head:
            allowed_prefixes.add(head)
    for token in RULE_TOKEN.findall(text):
        if token in allowed or token in allowed_prefixes:
            continue
        return "提到了未在本次分析中出现的规则编号：" + token
    return None


def _normalize_outputs(outputs, schema):
    """按 skill 声明的 output schema 裁剪；类型不符的键直接丢弃而不是报错。"""
    if outputs is None:
        return {}
    if not isinstance(outputs, dict):
        raise SkillError("insufficient_evidence", "outputs 必须是对象")
    if not schema:
        return {}
    clean = {}
    for key, spec in schema.items():
        if key not in outputs:
            continue
        kind, limit = spec
        value = outputs[key]
        if kind == "str":
            if not isinstance(value, str):
                continue
            value = value.strip()
            if not value or len(value) > limit:
                continue
        elif kind == "list_str":
            if not isinstance(value, list):
                continue
            items = [str(item).strip() for item in value if isinstance(item, str) and item.strip()]
            if not items or len(items) > limit:
                continue
            value = items
        else:  # pragma: no cover - schema 由本仓库自己声明，出现未知类型属编码错误
            continue
        clean[key] = value
    return clean


def validate_skill_result(raw, resolve, *, allowed_rule_ids=(), output_schema=None,
                          max_claims=MAX_CLAIMS_PER_RESULT):
    """三层校验，返回可直接下发的 SkillResult。

    L1 信封：skill / status / target 合法，claims 是列表。
    L2 条目：text 长度、kind 与 confidence 枚举、evidence 非空且数量受限、禁写规则。
    L3 引用：逐条解析 evidence；解不出的引用剔除，整条无证据的 claim 丢弃。

    返回对象的 `citations` 与 `dropped` 是"这次校验做了什么"的唯一记录，
    调用方（runner / server / 测试）只信这两个字段，不猜。
    """
    if not isinstance(raw, dict):
        raise SkillError("refused", "SkillResult 必须是对象")
    skill = raw.get("skill")
    if skill not in SKILLS:
        raise SkillError("refused", "未注册的 skill：" + str(skill)[:40])
    status = raw.get("status")
    if status not in STATUSES:
        raise SkillError("refused", "非法状态：" + str(status)[:40])
    if status != "ok":
        # 非 ok 状态不承载 claim，但仍然回填统一的元信息与 outputs，保证下游不必分支处理。
        # outputs 在非 ok 时是"为什么没有结论"的说明文字（标题/摘要），不是结论本身。
        return new_result(skill, raw.get("target"), status=status, notes=raw.get("notes"),
                          outputs=_normalize_outputs(raw.get("outputs"), output_schema or {}),
                          diagnostics=raw.get("diagnostics"), generator=raw.get("generator"),
                          dropped=raw.get("dropped"))
    target = raw.get("target")
    if not isinstance(target, str) or not target.strip():
        raise SkillError("refused", "缺少 target 引用")

    claims_in = raw.get("claims")
    if not isinstance(claims_in, list):
        raise SkillError("refused", "claims 必须是列表")

    allowed = set(allowed_rule_ids or ())
    kept, dropped = [], []
    total_refs = resolved_refs = 0

    for item in claims_in[:max_claims]:
        if not isinstance(item, dict):
            dropped.append({"reason": "claim 不是对象", "text": str(item)[:80]})
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            dropped.append({"reason": "claim 缺少正文", "text": ""})
            continue
        text = " ".join(text.split())
        if len(text) > MAX_CLAIM_CHARS:
            dropped.append({"reason": "正文超过 {} 字".format(MAX_CLAIM_CHARS), "text": text[:80]})
            continue
        kind = item.get("kind")
        if kind not in CLAIM_KINDS:
            dropped.append({"reason": "未知的 claim 类型：" + str(kind)[:20], "text": text[:80]})
            continue
        confidence = item.get("confidence")
        if confidence not in CONFIDENCES:
            dropped.append({"reason": "未知的置信度：" + str(confidence)[:20], "text": text[:80]})
            continue
        reason = _check_banned(text) or _check_rule_tokens(text, allowed)
        if reason:
            dropped.append({"reason": reason, "text": text[:80]})
            continue
        evidence = item.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            dropped.append({"reason": "claim 没有证据引用", "text": text[:80]})
            continue
        refs, ref_reason = [], None
        for ref in evidence[:MAX_EVIDENCE_PER_CLAIM]:
            total_refs += 1
            if not isinstance(ref, str):
                ref_reason = "证据引用不是字符串"
                continue
            outcome = resolve(ref)
            if isinstance(outcome, dict) and outcome.get("ok"):
                resolved_refs += 1
                refs.append(ref)
            else:
                ref_reason = (outcome or {}).get("error") if isinstance(outcome, dict) else "无法解析引用"
        if not refs:
            dropped.append({"reason": ref_reason or "证据引用全部无法解析", "text": text[:80]})
            continue
        kept.append({"kind": kind, "text": text, "evidence": refs, "confidence": confidence})

    coverage = round(resolved_refs / total_refs, 4) if total_refs else 0.0
    result = new_result(
        skill,
        target,
        status="ok" if kept else "insufficient_evidence",
        claims=kept,
        outputs=_normalize_outputs(raw.get("outputs"), output_schema),
        generator=raw.get("generator"),
        notes=list(raw.get("notes") or [])[:MAX_NOTES],
        diagnostics=raw.get("diagnostics"),
        dropped=dropped,
    )
    result["citations"] = {
        "count": total_refs,
        "resolved": resolved_refs,
        "unresolved": total_refs - resolved_refs,
        "coverage": coverage,
    }
    return result
