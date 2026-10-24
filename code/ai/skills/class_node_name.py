"""类图节点名：给类图上的每个框一个短标签。

问题很具体：类图里一堆框只写着类名，图能连起来但读不出"这个类是干嘛的"。
本 skill 只做一件小事——在类名旁边补一句**由现有事实支撑**的职责短语，以及
"为什么这么标"的依据。

不做的事：不判断类设计好坏（那是 solid-review），不新增属性/方法（那是事实层的事）。
"""
from __future__ import annotations

from .. import contract
from . import base
from .base import Skill

MAX_METHODS_IN_LABEL = 4


class ClassNodeName(Skill):
    id = "class-node-name"
    title = "类图节点名"
    target_kinds = ("class",)
    output_schema = {"headline": ("str", 80), "subtitle": ("str", 160), "tags": ("list_str", 5)}

    def candidates(self, env, limit=12):
        index = env["index"]
        rows = []
        for ident, entry in index.classes.items():
            rows.append((-(len(entry.get("methods") or [])), entry.get("file") or "", entry.get("line") or 0, ident))
        rows.sort()
        return ["class:" + row[-1] for row in rows[:limit]]

    def context(self, env, ref):
        ident, definition, entry = base.symbol_of(env, ref)
        path = entry.get("file")
        line = entry.get("line")
        end_line = entry.get("end_line") or line
        methods = []
        for method_id in entry.get("methods") or []:
            method = env["index"].functions.get(method_id)
            if method:
                methods.append(method)
        findings = env["index"].findings_in(path, line, end_line)
        inheritance = [edge for edge in env["index"].inheritance if edge.get("source") == ident]
        return {"ref": ref, "ident": ident, "definition": definition, "class": entry,
                "path": path, "line": line, "end_line": end_line,
                "module": env["index"].module_of(path),
                "methods": methods, "findings": findings, "inheritance": inheritance}

    def gap(self, ctx):
        if ctx["definition"].get("kind") != "class":
            return {"reason": "目标不是类"}
        return None

    def _label(self, ctx):
        name = ctx["class"].get("name") or ctx["ident"].rsplit(".", 1)[-1]
        count = len(ctx["methods"])
        bases = ctx["class"].get("bases") or []
        if count == 0 and not bases:
            return name + "（无方法，纯数据容器）"
        parts = []
        if count:
            names = [method.get("name") for method in ctx["methods"][:MAX_METHODS_IN_LABEL]]
            parts.append("{} 方法".format(count) if count > MAX_METHODS_IN_LABEL else base.join_limited(names))
        if bases:
            parts.append("继承 " + base.join_limited(bases, 2))
        return name + "（" + "，".join(parts) + "）"

    def render(self, ctx):
        index = ctx["ident"]
        name = ctx["class"].get("name") or "类"
        module = ctx["module"] or ctx["path"]
        count = len(ctx["methods"])
        claims = []

        evidence = ["class:" + index, "def:" + index]
        for method in ctx["methods"][:3]:
            evidence.append("function:" + method["id"])
        claims.append(contract.claim(
            "{} 位于模块 {}，共 {} 个方法；节点标签据此写成「{}」，让图上只看名字也能读出它的分工。".format(
                name, module, count, self._label(ctx)),
            evidence, kind="naming", confidence="high"))

        if ctx["inheritance"]:
            for edge in ctx["inheritance"][:2]:
                claims.append(contract.claim(
                    "{} 继承 {}；图上线要保留这条纵向关系，节点标签不必重复父类信息。".format(name, edge.get("target")),
                    ["inherit:{}->{}".format(edge.get("source"), edge.get("target")), "def:" + index],
                    kind="naming", confidence="high"))

        if count >= 5:
            claims.append(contract.claim(
                "{} 的方法有 {} 个，只写类名不足以看懂它做什么，标签里应带一句职责短语而不是只列方法名。".format(name, count),
                evidence, kind="naming", confidence="medium"))

        refs = base.finding_refs(ctx["findings"], limit=2)
        if refs:
            rules = base.join_limited([item.get("rule_id") for item in ctx["findings"]], 3)
            claims.append(contract.claim(
                "{} 上还有 {} 条规则发现（{}），标签可以带一个提示角标，把注意力引到问题所在的类上。".format(
                    name, len(ctx["findings"]), rules),
                refs + ["def:" + index], kind="naming", confidence="medium"))


        outputs = {"headline": base.short(self._label(ctx), 80),
                   "subtitle": base.short("{} · {} 行 · {}".format(module, ctx["line"], ctx["path"]), 160),
                   "tags": [tag for tag in [ctx["module"] or "", "class"] if tag]}
        return self.envelope(ctx, claims, outputs,
                             notes=["标签只由类名、方法集合、基类与规则发现构成，未推断类的业务含义。"])

    def prompt(self, ctx):
        return (
            "把这个类改写成类图节点上的标签。\n目标：{}\n类名：{}\n模块：{}\n起始行：{}\n"
            "方法（{} 个）：{}\n基类：{}\n命中规则：{}\n"
            "输出 outputs.headline（不超过 40 字）、outputs.subtitle、outputs.tags（最多 3 个）。\n"
            "可用 evidence refs：{}\n"
        ).format(
            ctx["ref"], ctx["class"].get("name"), ctx["module"], ctx["line"],
            len(ctx["methods"]), base.join_limited([m.get("name") for m in ctx["methods"]], 8),
            base.join_limited(ctx["class"].get("bases") or [], 4),
            base.join_limited([item.get("rule_id") for item in ctx["findings"]], 4),
            ", ".join(["class:" + ctx["ident"], "def:" + ctx["ident"]]
                      + ["function:" + m["id"] for m in ctx["methods"][:3]]
                      + base.finding_refs(ctx["findings"], limit=2)))



SKILL = ClassNodeName()
