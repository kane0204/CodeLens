"""固定 DAG 的 runner：切片 → 表达 → 校验 → 缓存。

这张图对应"单个子任务内部"的执行模型，而不是整个应用的外层编排：

    [候选目标] → [切片] → [表达] → [三层校验] → [满意?]
                    ↑                                  │否
                    └────── 补一次上下文 ↵─────────────┘

三处刻意的设计：

1. **外层不重规划**。哪些 skill 跑、每个跑几个目标，在进来之前就定了；runner 内部
   只有"这一条上下文不够，补一次"的局部回退，不会回头改任务计划。反馈环一旦放到
   外层，就会变成"模型决定还要不要多跑几轮"，成本与延迟都不可控。
2. **表达失败不影响事实**。模板是基线，外部模型是可选增强；模型报错或输出不合格
   就退回模板，`generator` 字段会如实记录这次到底是谁产出的。
3. **缓存 key 只由确定性输入构成**：skill 版本、prompt 版本、provider/model、
   目标指纹。不含时间、不含随机数，所以同一个 key 永远对应同一份输出。
"""
from __future__ import annotations

import ast
from collections import OrderedDict

from core_engine import facts

from . import contract, provider as provider_module
from . import skills as skill_registry
from .skills import base

#: 一次请求最多跑多少个目标（skill × target）。
MAX_TARGETS = 24
#: 每个 skill 默认挑多少个候选目标。
DEFAULT_PER_SKILL = 12
#: 进程内缓存条数上限。够覆盖一次会话的反复查看，又不至于把内存耗在没有复用的目标上。
CACHE_LIMIT = 256

#: 请求里的目标引用类型 → 该 skill 接受的前缀。
ACCEPTED_PREFIXES = {
    "def": ("def", "function"),
    "function": ("def", "function"),
    "class": ("class", "def"),
    "module": ("module",),
    "project": ("summary",),
}

LIMITATIONS = [
    "表达层不产出事实：每条 claim 都挂在 IR 能解析的引用上，解析不到的引用与整条 claim 一起丢弃。",
    "默认使用确定性模板，同一输入得到逐字节相同的输出；配置外部模型后文本会随模型变化，但校验规则不变。",
    "SOLID 只复核 S、O、D 三条，L 与 I 需要完整的类型层级与接口使用图，当前事实层不提供。",
    "缓存 key 由 skill 版本、prompt 版本、provider/model 与目标指纹构成，不含时间与随机数。",
]


def build_env(index, trees=None, rules=None):
    """组装 skill 需要的只读环境。`trees` 可以复用一个已经解析好的语法树表。

    源码只在这里被 `ast.parse` 一次，之后所有 skill 共用；没有 `ensure_trees()`
    被调用之前的自动补解析，避免为了"可能用到"而先付解析成本。
    """
    env = {"index": index, "trees": dict(trees or {}), "nodes": {}, "facts": facts, "rules": rules or {}}

    def rebuild_nodes():
        nodes = {}
        for path, tree in env["trees"].items():
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    nodes.setdefault((path, node.lineno), node)
        env["nodes"] = nodes

    def ensure_trees():
        """补解析：只补缺的文件，已解析的不重复解析。幂等。"""
        added = False
        for path, record in env["index"].files.items():
            if path in env["trees"]:
                continue
            source = record.get("source")
            if not isinstance(source, str):
                continue
            try:
                env["trees"][path] = ast.parse(source, feature_version=(3, 11))
            except (SyntaxError, ValueError):
                continue
            added = True
        if added or not env["nodes"]:
            rebuild_nodes()
        return added

    rebuild_nodes()
    env["ensure_trees"] = ensure_trees
    return env


class Cache:
    """极简 LRU。只用确定性的 key，不做 TTL——事实变了指纹就变了。"""

    def __init__(self, limit=CACHE_LIMIT):
        self.limit = limit
        self._rows = OrderedDict()

    def get(self, key):
        if key not in self._rows:
            return None
        self._rows.move_to_end(key)
        return self._rows[key]

    def put(self, key, value):
        self._rows[key] = value
        self._rows.move_to_end(key)
        while len(self._rows) > self.limit:
            self._rows.popitem(last=False)

    def clear(self):
        self._rows.clear()

    def __len__(self):
        return len(self._rows)


SHARED_CACHE = Cache()


class Runner:
    """把一组 (skill, target) 跑成 SkillResult 列表。"""

    def __init__(self, env, provider=None, cache=None):
        self.env = env
        self.cache = cache if cache is not None else SHARED_CACHE
        self.provider = provider or provider_module.resolve_provider()[0]

    # ---- 目标选择 --------------------------------------------------------

    def _accepts(self, skill, ref):
        kind = str(ref).split(":", 1)[0]
        for target_kind in skill.target_kinds:
            if kind in ACCEPTED_PREFIXES.get(target_kind, (target_kind,)):
                return True
        return False

    def select(self, skill_ids, targets=None, per_skill=DEFAULT_PER_SKILL):
        """返回 [(skill, ref)]，顺序确定：先按请求里的 skill 顺序，再按目标顺序。"""
        chosen = []
        for skill_id in skill_ids:
            skill = skill_registry.get(skill_id)
            if skill is None:
                continue
            if targets:
                refs = [ref for ref in targets if self._accepts(skill, ref)]
            else:
                refs = [ref for ref in skill.candidates(self.env, per_skill) if self._accepts(skill, ref)]
            for ref in refs[:per_skill]:
                if (skill.id, ref) not in [(item.id, r) for item, r in chosen]:
                    chosen.append((skill, ref))
            if len(chosen) >= MAX_TARGETS:
                break
        return chosen[:MAX_TARGETS]

    # ---- 单条执行 --------------------------------------------------------

    def _fingerprint(self, ref):
        scope = "all"
        if ref.startswith(("def:", "function:", "class:")):
            candidate = ref.split(":", 1)[1]
            if candidate in self.env["index"].defs:
                scope = candidate
        return self.env["index"].fingerprint(scope)

    def cache_key(self, skill, ref):
        """缓存 key 必须包含目标本身：不同 ref 的同一个 skill 不是同一份输出。"""
        return contract.short_hash({
            "schema": contract.SCHEMA_VERSION,
            "skill": skill.id,
            "skill_version": skill.version,
            "prompt_version": skill.prompt_version,
            "provider": self.provider.id,
            "model": self.provider.model,
            "target": ref,
            "fingerprint": self._fingerprint(ref),
        })[:32]

    def _slice_stats(self, ctx):
        if "statements" in ctx:
            return {"statements": len(ctx.get("statements") or []),
                    "truncated": bool(ctx.get("truncated"))}
        if "findings" in ctx:
            return {"findings": len(ctx.get("findings") or [])}
        return {}

    def _degraded(self, skill, ref, status, message, cache_key, attempts=1, notes=None, ctx=None):
        """构造非 ok 结果。这类结果同样进缓存：同一输入下「没有证据」也是稳定结论。

        `ctx` 存在时会跑一次模板渲染，把 headline 之类的说明文字留在 outputs 里——
        前端需要一句"为什么这里没有结论"，而不是一片空白。
        """
        outputs = {}
        if ctx is not None:
            try:
                outputs = (skill.render(ctx) or {}).get("outputs") or {}
            except contract.SkillError:
                outputs = {}
        raw = contract.new_result(skill.id, ref, status=status, outputs=outputs,
                                  notes=list(notes or []) + [base.short(message, contract.MAX_NOTE_CHARS)],
                                  diagnostics={"cache_hit": False, "attempts": attempts})
        validated = contract.validate_skill_result(raw, self.env["index"].resolve,
                                                   allowed_rule_ids=self.env["index"].rule_ids(),
                                                   output_schema=skill.output_schema)
        validated["cache_key"] = cache_key
        return validated

    def _one(self, skill, ref):
        key = self.cache_key(skill, ref)
        cached = self.cache.get(key)
        if cached is not None:
            hit = dict(cached)
            hit["diagnostics"] = dict(cached.get("diagnostics") or {})
            hit["diagnostics"]["cache_hit"] = True
            hit["cache_key"] = key
            return hit

        index = self.env["index"]
        try:
            ctx = skill.context(self.env, ref)
        except contract.SkillError as exc:
            result = self._degraded(skill, ref, exc.kind, str(exc), key)
            self.cache.put(key, result)
            return result

        attempts = 1
        gap = skill.gap(ctx)
        if gap is not None:
            if gap.get("fatal"):
                result = self._degraded(skill, ref, "insufficient_evidence", gap.get("reason") or "",
                                        key, attempts=attempts, ctx=ctx)
                self.cache.put(key, result)
                return result
            ctx = skill.repair(self.env, ctx, gap)
            attempts = 2
            gap = skill.gap(ctx)
            if gap is not None:
                result = self._degraded(skill, ref, "insufficient_evidence",
                                        gap.get("reason") or "补一次上下文后仍不足", key,
                                        attempts=attempts, ctx=ctx)
                self.cache.put(key, result)
                return result

        used_provider = self.provider
        try:
            raw, diagnostics = used_provider.produce(skill, ctx)
        except (provider_module.ProviderError, contract.SkillError) as exc:
            used_provider = provider_module.TemplateProvider()
            raw = skill.render(ctx)
            raw["generator"] = {"provider": used_provider.id, "model": used_provider.model,
                                "prompt_version": skill.prompt_version}
            diagnostics = {"attempts": attempts, "provider": used_provider.id,
                           "fallback": base.short(str(exc), 120)}
        diagnostics = dict(diagnostics or {})
        diagnostics.setdefault("attempts", attempts)
        diagnostics["cache_hit"] = False
        diagnostics["slice"] = self._slice_stats(ctx)
        raw["diagnostics"] = diagnostics
        raw.setdefault("skill", skill.id)
        raw.setdefault("target", ref)

        try:
            validated = contract.validate_skill_result(
                raw, index.resolve, allowed_rule_ids=index.rule_ids(), output_schema=skill.output_schema)
        except contract.SkillError as exc:
            validated = self._degraded(skill, ref, exc.kind, str(exc), key, attempts=attempts)
        validated["cache_key"] = key
        self.cache.put(key, validated)
        return validated

    # ---- 批量 ------------------------------------------------------------

    def run(self, skill_ids, targets=None, per_skill=DEFAULT_PER_SKILL):
        """跑一批目标，返回 `{"results", "summary", "warnings", "limitations"}`。"""
        if isinstance(skill_ids, str):
            skill_ids = [skill_ids]
        ordered_ids = []
        for skill_id in skill_ids or []:
            if skill_id in contract.SKILLS and skill_id not in ordered_ids:
                ordered_ids.append(skill_id)
        warnings = []
        for skill_id in skill_ids or []:
            if skill_id not in contract.SKILLS:
                warnings.append({"code": "unknown-skill", "message": "未注册的 skill：" + str(skill_id)[:40]})

        chosen = self.select(ordered_ids, targets=targets, per_skill=per_skill)
        results = [self._one(skill, ref) for skill, ref in chosen]

        counts = {status: 0 for status in contract.STATUSES}
        for item in results:
            counts[item.get("status")] = counts.get(item.get("status"), 0) + 1
        citations = {"count": 0, "resolved": 0, "unresolved": 0, "coverage": 0.0}
        for item in results:
            row = item.get("citations") or {}
            for field in ("count", "resolved", "unresolved"):
                citations[field] += int(row.get(field) or 0)
        if citations["count"]:
            citations["coverage"] = round(citations["resolved"] / citations["count"], 4)
        return {
            "results": results,
            "summary": {"requested": len(results), "ok": counts.get("ok", 0),
                        "insufficient_evidence": counts.get("insufficient_evidence", 0),
                        "need_more": counts.get("need_more", 0),
                        "refused": counts.get("refused", 0),
                        "citations": citations},
            "warnings": warnings,
            "limitations": list(LIMITATIONS),
        }
