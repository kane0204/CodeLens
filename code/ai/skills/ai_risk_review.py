"""AI 特有风险审查：解释规则引擎已经算出来的风险，不是重新判断风险。

这类风险有个共同点——AI 生成的代码特别容易踩：

- 吞异常（`except Exception: pass`）：失败被静默，调试时找不到现场；
- 假定外部状态成功（`open()` 没有对应的失败路径）：本地跑通、线上炸；
- 硬编码敏感字面量；
- 圈复杂度与嵌套一起升高：单点看起来都对，合起来没人敢改；
- 模块循环依赖：局部改动引发连锁重编。

本 skill 的输入只有 `analyze()`（含补充规则）产出的 findings。**没有 finding 时
直接返回 insufficient_evidence**——"没命中阈值"和"没有风险"是两件事，AI 不负责
把后者编出来。
"""
from __future__ import annotations

from .. import contract
from . import base
from .base import Skill

#: 每条规则的解释与建议。没有列出的规则只在计数里出现，不单独展开。
PLAYBOOK = {
    "CC-01": ("圈复杂度超过阈值：分支一多，改一个条件就要在脑子里跑完全部分支。",
              "把互不相关的条件拆成独立函数，让每个函数只有一条主路径。"),
    "LEN-01": ("函数过长：一次读不完就难以在改动时判断影响面。",
               "按「准备数据 / 做判断 / 落结果」三段拆开，每段一个名字。"),
    "DEPTH-01": ("嵌套过深：条件与循环套在一起时，读者要同时维护多层心智状态。",
                 "用提前返回削平分支，把循环体里的大段逻辑提成函数。"),
    "A4": ("硬编码敏感字面量：这类值一旦进版本库就很难彻底清除。",
           "改从环境变量或配置读取，并确认它是否已经被提交过。"),
    "A3-IO": ("IO 调用附近没有发现匹配的失败处理：本地环境通常不会暴露这类问题。",
              "在调用点显式处理失败，或确认上层已有统一兜底，并在注释里写清楚。"),
    "CYCLE-01": ("模块循环依赖：两边互相引用后，任何一边都难以单独测试。",
                 "把共用部分提取成更底层的模块，让依赖方向保持单向。"),
    "A5-DEAD": ("存在没有调用点的函数：可能是遗留代码，也可能是外部入口。",
                "先确认是否由框架或测试调用；确认无人使用后再删除。"),
    "A8-DEFENSIVE": ("过宽捕获后什么都不做：异常被静默吞掉，失败现场直接消失。",
                     "至少记录日志，或缩小捕获类型；确实可忽略时写明理由。"),
}

SEVERITY_WEIGHT = {"critical": 3, "warning": 2, "info": 1}


class AIRiskReview(Skill):
    id = "ai-risk-review"
    title = "AI 特有风险审查"
    target_kinds = ("module", "project")
    output_schema = {"headline": ("str", 120), "top": ("list_str", 6)}

    def candidates(self, env, limit=12):
        index = env["index"]
        refs = ["summary:project"]
        rows = []
        for module, path in index.modules.items():
            count = len(index.findings_by_file.get(path) or [])
            if count:
                rows.append((-count, path, module))
        rows.sort()
        refs.extend("module:" + row[2] for row in rows[:max(0, limit - 1)])
        return refs

    def context(self, env, ref):
        index = env["index"]
        if ref.startswith("summary:"):
            findings = list(index.findings.values())
            return {"ref": ref, "scope": "project", "path": None, "module": None,
                    "findings": findings, "rule_ids": sorted({f.get("rule_id") for f in findings})}
        if not ref.startswith("module:"):
            base.need("refused", "AI 风险审查只接受模块或项目目标：" + str(ref)[:32])
        module = ref.split(":", 1)[1]
        if module not in index.modules:
            base.need("insufficient_evidence", "模块不在本次分析范围内：" + module)
        piece = index.slice_module(module)
        # slice_module 的 findings 是 id 列表（IR 的引用口径），这里换回完整记录。
        rows = [index.findings.get(ident) for ident in (piece.get("findings") or [])]
        findings = [row for row in rows if row]
        return {"ref": ref, "scope": "module", "path": piece.get("path"), "module": module,
                "piece": piece, "findings": findings,
                "rule_ids": sorted({f.get("rule_id") for f in findings})}

    def gap(self, ctx):
        if not ctx["findings"]:
            return {"reason": "本次规则口径没有产出可复核的风险事实",
                    "retry": None, "fatal": True}
        return None

    def repair(self, env, ctx, gap):
        return ctx

    def _groups(self, ctx):
        """按规则聚合并按严重程度排序。顺序确定：先权重，再规则编号。"""
        buckets = {}
        for item in ctx["findings"]:
            buckets.setdefault(item.get("rule_id"), []).append(item)
        rows = []
        for rule, items in buckets.items():
            weight = max(SEVERITY_WEIGHT.get(entry.get("severity"), 0) for entry in items)
            rows.append((-weight, rule, items))
        rows.sort(key=lambda row: (row[0], row[1]))
        return [(rule, items) for _weight, rule, items in rows]

    def render(self, ctx):
        scope_label = "整个项目" if ctx["scope"] == "project" else "模块 " + str(ctx["module"])
        groups = self._groups(ctx)
        claims = []
        if ctx["scope"] == "project":
            anchor = ["summary:project"]
        else:
            anchor = ["module:" + str(ctx["module"]), "file:" + str(ctx["path"])]

        for rule, items in groups[:6]:
            text, suggestion = PLAYBOOK.get(rule, ("命中规则 {} 的位置值得复核。".format(rule), "按规则说明逐处核对。"))
            refs = base.finding_refs(items, limit=3)
            if not refs:
                continue
            claims.append(contract.claim(
                "{}：{}（{} 处命中，例如第 {} 行）这类问题在 AI 生成的代码里很常见，{}".format(
                    rule, text, len(items),
                    items[0].get("line"), suggestion),
                refs, kind="advice", confidence="high"))

        if not claims and anchor:
            claims.append(contract.claim(
                "{} 在本次口径下没有命中已展开的规则；这只说明计数没超阈值，不能当作「没有问题」的结论。".format(scope_label),
                anchor[:2], kind="advice", confidence="low"))

        top = ["{}（{} 处，最高严重度 {}）".format(
            rule, len(items), max(items, key=lambda f: SEVERITY_WEIGHT.get(f.get("severity"), 0)).get("severity"))
            for rule, items in groups[:6]]
        headline = base.short("{}：{} 条规则发现，涉及 {} 类规则".format(
            scope_label, len(ctx["findings"]), len(groups)), 120)
        return self.envelope(ctx, claims, {"headline": headline, "top": top},
                             notes=["只解释规则引擎已产出的 finding，未新增任何风险判断。"])

    def prompt(self, ctx):
        rendered = ["{} 第 {} 行（{}）：{}".format(item.get("rule_id"), item.get("line"),
                                                  item.get("severity"), item.get("message"))
                    for item in ctx["findings"][:10]]
        return (
            "把下面已经算好的规则发现改写成中文复核说明。\n目标：{}\n范围：{}\n"
            "发现：\n{}\n输出 outputs.headline 与 outputs.top（不超过 6 条），"
            "每条 claim 的 evidence 必须从 finding 引用里挑。\n"
            "可用 evidence refs：{}\n"
        ).format(ctx["ref"], ctx["scope"], "\n".join(rendered),
                 ", ".join(base.finding_refs(ctx["findings"], limit=6)))


SKILL = AIRiskReview()
