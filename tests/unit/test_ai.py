"""AI 表达层的契约测试：重点不是"文字写得好不好"，而是"越界的话进不来"。"""
import base64
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import analyze
from core_engine import rules as extra_rules
from core_engine.ir import build_index
from ai import contract, runner
from ai import skills as skill_registry
from ai.provider import TemplateProvider

SOURCE = '''"""demo module."""
import json


class Box:
    def __init__(self):
        self.items = []
        self.path = "data.json"

    def put(self, item):
        if not item:
            return None
        self.items.append(item)
        return len(self.items)

    def flush(self):
        try:
            with open(self.path, "w", encoding="utf-8") as fh:
                json.dump(self.items, fh)
        except Exception:
            pass
'''

PLAIN = '''class Wide:
    def a(self):
        pass

    def b(self):
        pass

    def c(self):
        pass

    def d(self):
        pass


def helper():
    return 1
'''

#: 零 finding 的样本：`_helper` 以下划线开头、`main` 是入口名，都不进 A5-DEAD。
CLEAN = '''def _helper():
    return 1


def main():
    return _helper()
'''


def payload(files):
    return {"project": "ai-test",
            "files": [{"path": p, "content_base64": base64.b64encode(s.encode()).decode()}
                      for p, s in files.items()]}


def build(files=None):
    result = analyze(payload(files or {"box.py": SOURCE}))
    extra = extra_rules.evaluate(result)
    merged = extra_rules.merge(result, extra)
    index = build_index(merged)
    env = runner.build_env(index, rules=extra)
    env["ensure_trees"]()
    return merged, extra, index, env


class ContractTests(unittest.TestCase):
    def test_registry_matches_contract(self):
        self.assertEqual(sorted(skill_registry.REGISTRY), sorted(contract.SKILLS))
        for skill_id, meta in contract.SKILLS.items():
            skill = skill_registry.REGISTRY[skill_id]
            self.assertEqual(skill.version, meta["version"])

    def test_banned_percent_is_dropped(self):
        _, _, index, _ = build()
        raw = contract.new_result("logic-summary", "def:box.Box.put", claims=[
            contract.claim("这里有 80% 的可能会出错。", ["def:box.Box.put"])])
        out = contract.validate_skill_result(raw, index.resolve)
        self.assertEqual(out["claims"], [])
        self.assertTrue(out["dropped"])
        self.assertEqual(out["status"], "insufficient_evidence")

    def test_banned_absolute_assertion_is_dropped(self):
        _, _, index, _ = build()
        raw = contract.new_result("logic-summary", "def:box.Box.put", claims=[
            contract.claim("已确认这里没有副作用。", ["def:box.Box.put"])])
        out = contract.validate_skill_result(raw, index.resolve)
        self.assertEqual(out["claims"], [])

    def test_rule_token_outside_allowed_is_dropped(self):
        _, _, index, _ = build()
        raw = contract.new_result("solid-review", "class:box.Box", claims=[
            contract.claim("命中了 CC-01 的口径。", ["class:box.Box"])])
        out = contract.validate_skill_result(raw, index.resolve, allowed_rule_ids=["SRP-01"])
        self.assertEqual(out["claims"], [])
        self.assertIn("CC-01", json.dumps(out["dropped"], ensure_ascii=False))

    def test_rule_family_prefix_is_allowed(self):
        # 引用 A8-DEFENSIVE 时会额外匹配出 A8，这个前缀必须放行，否则整句被误删。
        _, _, index, _ = build()
        raw = contract.new_result("ai-risk-review", "summary:project", claims=[
            contract.claim("A8-DEFENSIVE：过宽捕获后静默。", ["summary:project"])])
        out = contract.validate_skill_result(raw, index.resolve,
                                             allowed_rule_ids=["A8-DEFENSIVE"])
        self.assertEqual(len(out["claims"]), 1)

    def test_unresolvable_evidence_drops_claim(self):
        _, _, index, _ = build()
        raw = contract.new_result("logic-summary", "def:box.Box.put", claims=[
            contract.claim("这句挂在不存在的引用上。", ["def:box.Box.nope"])])
        out = contract.validate_skill_result(raw, index.resolve)
        self.assertEqual(out["claims"], [])
        self.assertEqual(out["citations"]["unresolved"], 1)
        self.assertEqual(out["citations"]["coverage"], 0.0)

    def test_non_ok_status_carries_no_claims(self):
        _, _, index, _ = build()
        raw = contract.new_result("logic-summary", "def:box.Box.put", status="refused",
                                  claims=[contract.claim("不该出现的结论。", ["def:box.Box.put"])],
                                  outputs={"headline": "说明文字", "steps": ["一步"]})
        out = contract.validate_skill_result(raw, index.resolve,
                                              output_schema={"headline": ("str", 120),
                                                             "steps": ("list_str", 8)})
        self.assertEqual(out["claims"], [])
        self.assertEqual(out["status"], "refused")
        self.assertEqual(out["outputs"]["headline"], "说明文字")

    def test_outputs_are_clipped_by_schema(self):
        _, _, index, _ = build()
        schema = {"headline": ("str", 120), "top": ("list_str", 6)}
        raw = contract.new_result("solid-review", "class:box.Box",
                                  outputs={"headline": "x" * 400, "top": ["a"] * 20})
        out = contract.validate_skill_result(raw, index.resolve, output_schema=schema)
        # 超限的字段整条丢弃，不做截断：半截标题比没有标题更容易被误读。
        self.assertNotIn("headline", out["outputs"])
        self.assertNotIn("top", out["outputs"])

        ok = contract.new_result("solid-review", "class:box.Box",
                                 outputs={"headline": "合规标题", "top": ["a"] * 6})
        kept = contract.validate_skill_result(ok, index.resolve, output_schema=schema)
        self.assertEqual(len(kept["outputs"]["top"]), 6)
        self.assertEqual(kept["outputs"]["headline"], "合规标题")

    def test_canonical_json_is_order_insensitive(self):
        self.assertEqual(contract.canonical_json({"b": 1, "a": [2, 3]}),
                         contract.canonical_json({"a": [2, 3], "b": 1}))
        self.assertEqual(contract.short_hash({"a": 1}), contract.short_hash({"a": 1}))
        self.assertNotEqual(contract.short_hash({"a": 1}), contract.short_hash({"a": 2}))


class RulesTests(unittest.TestCase):
    def test_extra_rules_do_not_change_engine_output(self):
        # 补充规则是独立的：engine.analyze() 的指纹和 findings 不能被它改写。
        first = analyze(payload({"plain.py": PLAIN}))
        second = analyze(payload({"plain.py": PLAIN}))
        self.assertEqual(first["findings"], second["findings"])
        self.assertEqual(extra_rules.evaluate(first)["findings"] and
                         [f["rule_id"] for f in extra_rules.evaluate(first)["findings"]],
                         [f["rule_id"] for f in extra_rules.evaluate(second)["findings"]])

    def test_clean_project_has_no_engine_findings(self):
        self.assertEqual(analyze(payload({"plain.py": PLAIN}))["findings"], [])

    def test_srp_and_dead_code_are_detected(self):
        result = analyze(payload({"plain.py": PLAIN}))
        extra = extra_rules.evaluate(result)
        ids = [item["rule_id"] for item in extra["findings"]]
        self.assertIn("A5-DEAD", ids)  # helper 没有任何调用点

    def test_merge_renumbers_and_sorts(self):
        result = analyze(payload({"plain.py": PLAIN}))
        extra = extra_rules.evaluate(result)
        merged = extra_rules.merge(result, extra)
        ids = [item["id"] for item in merged["findings"]]
        self.assertEqual(ids, ["finding-" + str(i + 1) for i in range(len(ids))])
        self.assertEqual(merged["files"], result["files"])


class RunnerTests(unittest.TestCase):
    def test_all_targets_have_full_citation_coverage(self):
        _, _, _, env = build()
        out = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache()).run(
            ["logic-summary", "class-node-name", "solid-review"])
        for item in out["results"]:
            if item["status"] == "ok":
                self.assertEqual(item["citations"]["coverage"], 1.0, item["target"])
                self.assertTrue(item["claims"])

    def test_template_is_byte_identical_across_runs(self):
        _, _, _, env = build()
        skills = ["logic-summary", "class-node-name", "solid-review", "ai-risk-review"]
        one = runner.Runner(env, cache=runner.Cache()).run(skills)
        two = runner.Runner(env, cache=runner.Cache()).run(skills)
        self.assertEqual(json.dumps(one["results"], ensure_ascii=False, sort_keys=True),
                         json.dumps(two["results"], ensure_ascii=False, sort_keys=True))

    def test_cache_key_separates_targets(self):
        _, _, _, env = build()
        session = runner.Runner(env, cache=runner.Cache())
        skill = skill_registry.REGISTRY["class-node-name"]
        self.assertNotEqual(session.cache_key(skill, "class:box.Box"),
                            session.cache_key(skill, "class:box.Wide"))

    def test_second_run_hits_cache(self):
        _, _, _, env = build()
        cache = runner.Cache()
        first = runner.Runner(env, cache=cache).run(["logic-summary"])
        again = runner.Runner(env, cache=cache).run(["logic-summary"])
        self.assertTrue(all(item["diagnostics"]["cache_hit"] for item in again["results"]))
        self.assertFalse(any(item["diagnostics"]["cache_hit"] for item in first["results"]))
        self.assertEqual([item["cache_key"] for item in first["results"]],
                         [item["cache_key"] for item in again["results"]])

    def test_unknown_skill_is_reported_not_silently_ignored(self):
        _, _, _, env = build()
        out = runner.Runner(env).run(["nope", "solid-review"])
        self.assertEqual([item["code"] for item in out["warnings"]], ["unknown-skill"])

    def test_bad_target_degrades_instead_of_raising(self):
        _, _, _, env = build()
        out = runner.Runner(env).run(["logic-summary"], targets=["def:no.such.symbol"])
        self.assertEqual(out["results"][0]["status"], "insufficient_evidence")
        self.assertEqual(out["results"][0]["claims"], [])

    def test_ai_risk_without_findings_says_insufficient_evidence(self):
        # 没有 finding 不等于没有风险，这条 skill 必须显式承认证据不足。
        # CLEAN 用下划线开头的辅助函数与 main 入口，避开 A5-DEAD，凑出"零 finding"的样本。
        _, _, _, env = build({"clean.py": CLEAN})
        out = runner.Runner(env).run(["ai-risk-review"])
        self.assertTrue(out["results"])
        for item in out["results"]:
            self.assertEqual(item["status"], "insufficient_evidence")
            self.assertEqual(item["claims"], [])
            self.assertIn("headline", item["outputs"])

    def test_solid_review_states_scope_limit(self):
        _, _, _, env = build()
        out = runner.Runner(env).run(["solid-review"], targets=["class:box.Box"])
        texts = " ".join(item["text"] for item in out["results"][0]["claims"])
        self.assertIn("L 与 I", texts)

    def test_class_node_name_outputs_fit_schema(self):
        _, _, _, env = build()
        out = runner.Runner(env).run(["class-node-name"], targets=["class:box.Box"])
        outputs = out["results"][0]["outputs"]
        self.assertLessEqual(len(outputs["headline"]), 80)
        self.assertLessEqual(len(outputs["tags"]), 5)


class FactsTests(unittest.TestCase):
    def test_control_flow_is_deterministic(self):
        result = analyze(payload({"box.py": SOURCE}))
        tree = __import__("ast").parse(SOURCE, feature_version=(3, 11))
        target = [n for n in tree.body if getattr(n, "name", "") == "Box"][0]
        method = [n for n in target.body if getattr(n, "name", "") == "put"][0]
        one = extra_rules.facts if hasattr(extra_rules, "facts") else None
        import core_engine.facts as facts
        first = json.dumps(facts.build_control_flow(method), sort_keys=True)
        second = json.dumps(facts.build_control_flow(method), sort_keys=True)
        self.assertEqual(first, second)
        self.assertTrue(json.loads(first)["available"])

    def test_ir_refs_roundtrip(self):
        _, _, index, _ = build()
        for ref in ("summary:project", "file:box.py", "module:box",
                    "def:box.Box.put", "class:box.Box"):
            self.assertTrue(index.resolve(ref)["ok"], ref)
        self.assertFalse(index.resolve("def:box.Box.nope")["ok"])


if __name__ == "__main__":
    unittest.main()
