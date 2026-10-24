"""代码逻辑总结：把一个函数讲成人话。

输入全部来自事实层：`ir.slice_function()` 给出函数头与逐条语句，`facts.build_control_flow()`
给出基本块与边，`facts.build_def_use()` 给出名字的定义-使用位置。本 skill 只负责
把这些拼成"先做什么、再做什么、什么情况下走另一条路"。

刻意不做的事：不评价写得对不对（那是规则发现的事）、不猜变量含义（源码里的字符串
摘要不参与总结）、不把推导出来的行为说成事实（副作用只列已解析的调用点）。
"""
from __future__ import annotations

from .. import contract
from . import base
from .base import Skill

#: 一次总结最多讲多少步。超过就只讲开头与结尾，中间用一句交代。
MAX_STEPS = 8
#: 步骤里有意义的语句类型（跳过 Pass 这类噪音）。
SKIP_TYPES = {"Pass"}
#: 被视为带副作用的调用名。
SIDE_EFFECT_CALLS = {"open", "print", "write", "writelines", "remove", "unlink", "mkdir",
                     "makedirs", "rename", "replace", "system", "run", "Popen", "dump", "dumps"}


class LogicSummary(Skill):
    id = "logic-summary"
    title = "代码逻辑总结"
    target_kinds = ("def",)
    output_schema = {"headline": ("str", 120), "steps": ("list_str", MAX_STEPS)}

    def candidates(self, env, limit=12):
        index = env["index"]
        rows = []
        for ident, entry in index.functions.items():
            rows.append((-(entry.get("cc") or 0), -(entry.get("length") or 0),
                         entry.get("file") or "", entry.get("line") or 0, ident))
        rows.sort()
        return ["def:" + row[-1] for row in rows[:limit]]

    def context(self, env, ref):
        ident, definition, _entry = base.symbol_of(env, ref)
        if definition.get("kind") != "function":
            base.need("refused", "代码逻辑总结只接受函数目标：" + str(definition.get("kind"))[:24])
        index = env["index"]
        piece = index.slice_function(ident)
        if not piece:
            base.need("insufficient_evidence", "无法切片该函数：" + ident)
        path = piece.get("file")
        line = piece.get("line")
        side_effects = []
        for call in piece.get("calls") or []:
            expression = call.get("expression") or ""
            last = expression.rsplit(".", 1)[-1]
            if last in SIDE_EFFECT_CALLS and call.get("status") == "resolved":
                side_effects.append(call)
        return {"ref": ref, "ident": ident, "definition": definition, "slice": piece,
                "path": path, "line": line, "module": piece.get("module"),
                "statements": piece.get("statements") or [],
                "truncated": bool(piece.get("statements_truncated")),
                "findings": piece.get("findings") or [],
                "callers": index.callers_of(ident),
                "side_effects": side_effects,
                "flow": base.flow_of(env, path, line),
                "def_use": self._def_use(env, path, line)}

    def _def_use(self, env, path, line):
        node = base.ast_node(env, path, line)
        if node is None:
            return {"available": False, "reason": "没有该函数的语法树节点"}
        return env["facts"].build_def_use(node)

    def gap(self, ctx):
        if not ctx["statements"]:
            return {"reason": "函数体没有可讲的语句", "retry": "trees"}
        if not ctx["flow"].get("available"):
            return {"reason": "缺少控制流切片", "retry": "trees"}
        return None

    def repair(self, env, ctx, gap):
        if gap.get("retry") == "trees" and env.get("ensure_trees"):
            env["ensure_trees"]()
            return self.context(env, ctx["ref"])
        return ctx

    # ---- 模板 ------------------------------------------------------------

    def _selected(self, ctx):
        rows = [item for item in ctx["statements"] if item.get("ast_type") not in SKIP_TYPES]
        if len(rows) <= MAX_STEPS:
            return rows, False
        return rows[:MAX_STEPS - 2] + rows[-2:], True

    def render(self, ctx):
        piece = ctx["slice"]
        name = piece.get("name") or ctx["ident"].rsplit(".", 1)[-1]
        params = piece.get("func", {}).get("params")
        rows, dropped_middle = self._selected(ctx)
        claims = []
        head_evidence = ["def:" + ctx["ident"]]

        if rows:
            head_evidence.append(base.statement_ref(ctx["ident"], rows[0].get("line")))
        signature = "{} 接收 {} 个参数".format(name, params if isinstance(params, int) else "若干")
        claims.append(contract.claim(
            "{} 从第 {} 行到第 {} 行，{}，包含 {} 条语句。".format(
                name, piece.get("line"), piece.get("end_line"), signature, len(ctx["statements"])),
            head_evidence, kind="responsibility", confidence="high"))

        for position, item in enumerate(rows, start=1):
            claims.append(contract.claim(
                "{}第 {} 行：{}。".format(base.ordinal(position), item.get("line"), item.get("description")),
                [base.statement_ref(ctx["ident"], item.get("line")), "def:" + ctx["ident"]],
                kind="step", confidence="high"))

        if dropped_middle:
            claims.append(contract.claim(
                "函数语句较多，中间部分已省略，只保留开头与结尾的关键步骤；完整轨迹请看法制视图的语句列表。",
                [base.statement_ref(ctx["ident"], rows[-1].get("line")), "def:" + ctx["ident"]],
                kind="step", confidence="medium"))

        flow = ctx["flow"]
        if flow.get("available"):
            branches = sum(1 for edge in flow.get("edges") or []
                           if edge[-1] in ("true", "false", "loop", "except"))
            if branches:
                claims.append(contract.claim(
                    "控制流切成 {} 个基本块、{} 条分支或循环边；也就是说它有 {} 处「走另一条路」的地方。".format(
                        len(flow.get("blocks") or []), len(flow.get("edges") or []), branches),
                    [base.statement_ref(ctx["ident"], rows[0].get("line")) if rows else "def:" + ctx["ident"],
                     "def:" + ctx["ident"]], kind="branch", confidence="high"))

        for call in ctx["side_effects"][:2]:
            claims.append(contract.claim(
                "第 {} 行调用了 {}，这一步会改动外部状态，不只是算值。".format(
                    call.get("line"), call.get("expression")),
                ["call:{}#{}".format(call.get("file"), call.get("line")), "def:" + ctx["ident"]],
                kind="side_effect", confidence="high"))

        if ctx["callers"]:
            callers = [str(item.get("source")) for item in ctx["callers"][:3] if item.get("source")]
            evidence = ["def:" + ctx["ident"]]
            if ctx["module"]:
                evidence.append("module:" + ctx["module"])
            claims.append(contract.claim(
                "它被 {} 处调用引用，调用方来自 {}；改动签名前先看这些位置。".format(
                    len(ctx["callers"]), base.join_limited(callers, 3)),
                evidence, kind="advice", confidence="medium"))

        steps = ["第 {} 行：{}".format(item.get("line"), item.get("description")) for item in rows]
        headline = base.short("{}：{} 条语句{}".format(
            name, len(ctx["statements"]),
            "，{} 处分支".format(len(flow.get("blocks") or []) - 1) if flow.get("available") and len(flow.get("blocks") or []) > 1 else ""), 120)
        return self.envelope(ctx, claims, {"headline": headline, "steps": steps[:MAX_STEPS]},
                             notes=["步骤文字由语句类型与已解析调用生成，未推断变量含义。"])

    def prompt(self, ctx):
        rendered = ["第 {} 行：{}".format(item.get("line"), item.get("description"))
                    for item in ctx["statements"][:MAX_STEPS]]
        return (
            "把这个函数讲成中文步骤。\n目标：{}\n函数名：{}\n行范围：{}-{}\n参数数：{}\n"
            "语句序列：\n{}\n基本块数：{}\n副作用调用：{}\n"
            "输出 outputs.headline（一句话职责，不超过 60 字）与 outputs.steps（不超过 {} 条）。\n"
            "可用 evidence refs 示例：def:{}\n"
        ).format(
            ctx["ref"], ctx["slice"].get("name"), ctx["slice"].get("line"), ctx["slice"].get("end_line"),
            ctx["slice"].get("func", {}).get("params"), "\n".join(rendered),
            len(ctx["flow"].get("blocks") or []),
            base.join_limited([c.get("expression") for c in ctx["side_effects"]], 4),
            MAX_STEPS, ctx["ident"])


SKILL = LogicSummary()
