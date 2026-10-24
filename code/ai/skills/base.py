"""Skill 基类与公共工具。

一个 skill 由四段组成，对应"三层夹心"里的内外两层确定性：

    candidates(env)      → 候选目标（确定性排序 + 截断，不让模型挑目标）
    context(env, ref)    → 切片：把 IR 里的结构化事实整理成上下文
    gap(ctx)             → 上下文够不够支撑结论；不够就返回缺什么
    render(ctx)          → 确定性模板产出（与外部模型输出同一形状）
    prompt(ctx)          → 给外部模型的 prompt，只含 ctx 里已切好的事实

`render` 与 `prompt` 必须描述同一个 ctx：模板是"给定这些事实的标准答案"，
模型是"给定这些事实的自由表达"，两者都过同一套校验。
"""
from __future__ import annotations

from .. import contract


class Skill:
    """Skill 基类。子类只需要声明 id/版本/目标类型，并实现方法。"""

    id = ""
    title = ""
    #: 该 skill 接受的目标引用类型，例如 ("def",) 或 ("class",)。
    target_kinds = ()
    #: outputs 的白名单，与 `contract._normalize_outputs` 的 schema 同形。
    output_schema = {}
    #: 改 prompt 或改模板文案都要升这个版本号（参与缓存 key）。
    prompt_version = "1.0.0"

    @property
    def version(self):
        """内容版本单一来源：只在 `contract.SKILLS` 里声明，避免两处版本漂移。"""
        return contract.SKILLS.get(self.id, {}).get("version", "0.0.0")

    def candidates(self, env, limit=12):
        """按确定性顺序返回候选 target 引用。"""
        return []

    def context(self, env, ref):
        """切片：返回 dict（含 `ref`），不足时抛 `contract.SkillError`。"""
        raise NotImplementedError

    def gap(self, ctx):
        """上一步切片是否需要补一次上下文。返回 None 或 {"reason": str}。"""
        return None

    def repair(self, env, ctx, gap):
        """一次补上下文的机会，返回新的 ctx。默认原样返回。"""
        return ctx

    def render(self, ctx):
        """确定性模板：返回未校验的信封。"""
        raise NotImplementedError

    def prompt(self, ctx):
        """给外部模型的提示词：只含已切片事实，附带允许的 refs 清单。"""
        return ""

    # ---- 公共小工具 ------------------------------------------------------

    def envelope(self, ctx, claims, outputs, status="ok", notes=None):
        """按统一形状拼未校验信封。`target` 一律取 ctx 的 ref。"""
        return contract.new_result(self.id, ctx["ref"], status=status, claims=claims,
                                   outputs=outputs, notes=notes)


def need(kind, message):
    """抛一个可恢复错误。runner 会把它变成 insufficient_evidence / need_more。"""
    raise contract.SkillError(kind, message)


def short(text, limit=120):
    """收敛空白并截断，避免模板把过长内容塞进 claim。"""
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    return value[:limit - 1] + "…"


def join_limited(items, limit=6, empty="无"):
    """把列表拼成中文顿号串，超出部分用"等 N 项"收尾。"""
    values = [str(item) for item in items if str(item).strip()]
    if not values:
        return empty
    head = "、".join(values[:limit])
    if len(values) > limit:
        return "{} 等 {} 项".format(head, len(values))
    return head


def ordinal(index):
    """1 → ①，只做到 20，超出回落数字加括号。"""
    digits = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
    if 1 <= index <= len(digits):
        return digits[index - 1]
    return "(" + str(index) + ")"


def target_payload(ref):
    """取 `kind:payload` 里的 payload。"""
    if not isinstance(ref, str) or ":" not in ref:
        need("refused", "目标引用格式非法：" + str(ref)[:40])
    return ref.split(":", 1)[1]


def symbol_of(env, ref):
    """把 `def:`/`function:`/`class:` 引用解析成 (ident, definition, entry)。

    `def:` 指向任意符号（函数、类、方法），`function:`/`class:` 指向更具体的表。
    解析不到就抛 insufficient_evidence——这一步不做任何猜测。
    """
    kind = ref.split(":", 1)[0]
    ident = target_payload(ref)
    index = env["index"]
    table = {"def": index.defs, "function": index.functions, "class": index.classes}.get(kind)
    if table is None:
        need("refused", "该 skill 不接受这种目标：" + str(kind)[:24])
    definition = index.defs.get(ident)
    entry = table.get(ident)
    if definition is None or entry is None:
        need("insufficient_evidence", "目标不在本次分析结果中：" + ident)
    return ident, definition, entry


def file_refs(env, path):
    """把一个文件相关的证据引用按固定顺序给出（file + 所在 module）。"""
    index = env["index"]
    refs = ["file:" + path]
    module = index.module_of(path)
    if module:
        refs.append("module:" + module)
    return refs


def finding_refs(findings, limit=4):
    """把 finding 记录转成 `finding:<id>` 引用。"""
    refs = []
    for item in findings[:limit]:
        ident = item.get("id")
        if isinstance(ident, str) and ident.startswith("finding-"):
            refs.append("finding:" + ident)
    return refs


def ast_node(env, path, line):
    """按 (文件, 起始行) 取定义节点。runner 会预先建好 nodes 表。"""
    table = env.get("nodes") or {}
    return table.get((path, line))


def flow_of(env, path, line):
    """取函数的基本块/边摘要；拿不到 AST 时返回不可用，而不是猜。"""
    node = ast_node(env, path, line)
    if node is None:
        return {"available": False, "reason": "没有该定义的语法树节点"}
    return env["facts"].build_control_flow(node)


def statement_ref(ident, line):
    return "stmt:{}#{}".format(ident, line)
