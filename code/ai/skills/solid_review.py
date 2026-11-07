"""Explain static checks for all five SOLID principles, without claiming proof."""
from __future__ import annotations

from .. import contract
from . import base
from .base import Skill

#: 本 skill 负责解释的规则。顺序即呈现顺序。
RULES = ("SRP-01", "OCP-01", "LSP-01", "ISP-01", "DIP-01")

LETTERS = {"LSP-01": "LSP（里氏替换）", "ISP-01": "ISP（接口隔离）", "SRP-01": "SRP（单一职责）", "OCP-01": "OCP（开闭）", "DIP-01": "DIP（依赖倒置）"}

ADVICE = {
    "LSP-01": "保持父方法接受的调用与行为契约；复核覆盖方法。",
    "ISP-01": "拆分被显式拒绝的接口职责，或改用组合。",
    "SRP-01": "按「数据 + 行为」切分：把操作同一组字段的方法聚在一起，其余迁出；方法多本身不是错，只是更难说清它负责什么。",
    "OCP-01": "如果这些分支处理的是彼此独立的行为，把差异下沉到各自类型的实现里；分支少的时候条件判断更好读，不必强改。",
    "DIP-01": "核对这几处构造是否需要可替换：需要就改成由调用方传入；不需要时直接构造是更简单的选择。",
}


class SolidReview(Skill):
    id = "solid-review"
    title = "SOLID 复核"
    prompt_version = "2.0.0"
    target_kinds = ("class",)
    output_schema = {"headline": ("str", 120), "checks": ("list_str", 5)}

    def candidates(self, env, limit=12):
        index = env["index"]
        rows = []
        for ident, entry in index.classes.items():
            path = entry.get("file")
            line = entry.get("line") or 0
            end_line = entry.get("end_line") or line
            hits = [item for item in index.findings_in(path, line, end_line)
                    if item.get("rule_id") in RULES]
            rows.append((-len(hits), -(len(entry.get("methods") or [])), path or "", line, ident))
        rows.sort()
        return ["class:" + row[-1] for row in rows[:limit]]

    def context(self, env, ref):
        ident, definition, entry = base.symbol_of(env, ref)
        if definition.get("kind") != "class":
            base.need("refused", "SOLID 复核对只接受类目标：" + str(definition.get("kind"))[:24])
        path = entry.get("file")
        line = entry.get("line")
        end_line = entry.get("end_line") or line
        findings = [item for item in env["index"].findings_in(path, line, end_line)
                    if item.get("rule_id") in RULES]
        metrics = (env.get("rules") or {}).get("metrics") or {}
        return {"ref": ref, "ident": ident, "definition": definition, "class": entry,
                "path": path, "line": line, "end_line": end_line,
                "module": env["index"].module_of(path),
                "methods": [env["index"].functions.get(m) for m in entry.get("methods") or []
                            if env["index"].functions.get(m)],
                "findings": findings, "rule_ids": sorted({item.get("rule_id") for item in findings}),
                "metrics": metrics}

    def gap(self, ctx):
        return None

    def render(self, ctx):
        name = ctx["class"].get("name") or "类"
        by_rule = {}
        for item in ctx["findings"]:
            by_rule.setdefault(item.get("rule_id"), []).append(item)
        claims = []
        checks = []
        evidence_head = ["class:" + ctx["ident"], "def:" + ctx["ident"]]

        for rule in RULES:
            items = by_rule.get(rule) or []
            letter = LETTERS[rule]
            if items:
                first = items[0]
                claims.append(contract.claim(
                    "{} 的{}：{}（口径值 {}，阈值 {}）。{}".format(
                        name, letter, first.get("message"),
                        first.get("actual"), first.get("threshold"), ADVICE[rule]),
                    base.finding_refs(items, limit=3) + ["def:" + ctx["ident"]],
                    kind="advice", confidence=first.get("confidence") or "low"))
                checks.append("{}：命中 {}".format(letter, first.get("actual")))
            else:
                checks.append("{}：未发现静态风险".format(letter))

        if not claims:
            claims.append(contract.claim(
                "{} 在{}五项静态检查中没有命中规则（方法数 {}）。"
                "这只说明当前静态规则未命中，不等于这个类就符合 SOLID。".format(
                    name, "、".join(LETTERS[rule] for rule in RULES), len(ctx["methods"])),
                evidence_head, kind="advice", confidence="low"))

        claims.append(contract.claim(
            "本次提供 S、O、L、I、D 五项静态检查。L 与 I 只覆盖已解析的单继承方法契约与显式拒绝；外部父类、多继承、自定义装饰器及行为契约仍需人工复核。",
            evidence_head, kind="advice", confidence="high"))

        headline = base.short("{}：{} 条 SOLID 口径命中".format(name, len(by_rule)), 120)
        return self.envelope(ctx, claims, {"headline": headline, "checks": checks},
                             notes=["口径是计数不是规范判定：命中说明值得复核，未命中不等于符合。"])

    def prompt(self, ctx):
        rendered = ["{} 第 {} 行：{}（口径值 {}，阈值 {}）".format(
            item.get("rule_id"), item.get("line"), item.get("message"),
            item.get("actual"), item.get("threshold")) for item in ctx["findings"][:6]]
        return (
            "复核这个类的 S/O/L/I/D 五项静态检查结果，改写成中文说明与建议。\n目标：{}\n类名：{}\n"
            "模块：{}\n方法数：{}\n命中：\n{}\n"
            "注意：未命中阈值不等于符合 SOLID，措辞必须保留这一点。\n"
            "输出 outputs.headline 与 outputs.checks（不超过 5 条）。\n"
            "可用 evidence refs：{}\n"
        ).format(ctx["ref"], ctx["class"].get("name"), ctx["module"], len(ctx["methods"]),
                 "\n".join(rendered) or "（无）",
                 ", ".join(["class:" + ctx["ident"], "def:" + ctx["ident"]]
                           + base.finding_refs(ctx["findings"], limit=3)))


SKILL = SolidReview()
