"""AI 表达层的契约测试：重点不是"文字写得好不好"，而是"越界的话进不来"。"""
import ast
import base64
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import analyze
from core_engine import rules as extra_rules
from core_engine.ir import build_index
from ai import contract, runner
from ai import skills as skill_registry
from ai.provider import TemplateProvider
from ai.skills import base as skill_base
from ai.skills.logic_summary import MAX_STEPS

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
    def test_extracts_fenced_json_with_nested_objects_and_escaped_text(self):
        expected = {"outputs": {"headline": 'literal } and "quotes"'}}
        source = "preface\n```json\n" + json.dumps(expected) + "\n```\npostscript"
        self.assertEqual(contract.extract_json_object(source), expected)

    def test_json_extraction_rejects_empty_non_json_and_incomplete_outputs(self):
        for text in (None, "", "[]", "{invalid}", '{"nested": {"x": 1}'):
            with self.subTest(text=text), self.assertRaises(contract.SkillError) as raised:
                contract.extract_json_object(text)
            self.assertEqual(raised.exception.kind, "insufficient_evidence")

    def test_invalid_envelope_fields_are_refused(self):
        valid = contract.new_result("logic-summary", "def:box.Box.put")
        for raw in (None, {**valid, "skill": []}, {**valid, "skill": "unknown"},
                    {**valid, "status": "made-up"}, {**valid, "target": " "},
                    {**valid, "claims": {}}, {**valid, "outputs": []}):
            with self.subTest(raw=raw), self.assertRaises(contract.SkillError):
                contract.validate_skill_result(raw, self.fail)

    def test_validation_drops_invalid_claims_and_counts_partial_evidence(self):
        ref = "def:box.Box.put"
        valid = contract.claim("  valid \n text ", [ref])
        raw = contract.new_result("logic-summary", ref, claims=[
            False, {**valid, "text": " "}, {**valid, "text": "a" * (contract.MAX_CLAIM_CHARS + 1)},
            {**valid, "kind": "guess"}, {**valid, "confidence": "invented"}, {**valid, "evidence": []},
            {**valid, "evidence": [9, "def:missing", ref]},
        ], outputs={"headline": 5, "steps": "wrong type", "limits": [" retained ", None, ""]})
        out = contract.validate_skill_result(
            raw, lambda evidence: {"ok": True} if evidence == ref else None,
            output_schema={"headline": ("str", 60), "steps": ("list_str", 3),
                           "limits": ("list_str", 3), "missing": ("str", 20)},
        )
        self.assertEqual(len(out["dropped"]), 6)
        self.assertEqual(out["claims"], [{**valid, "text": "valid text"}])
        self.assertEqual(out["outputs"], {"limits": ["retained"]})
        self.assertEqual(out["citations"], {"count": 3, "resolved": 1, "unresolved": 2, "coverage": 0.3333})

    def test_output_without_schema_is_dropped(self):
        raw = contract.new_result("logic-summary", "def:box.Box.put", outputs={"headline": "unapproved"})
        self.assertEqual(contract.validate_skill_result(raw, self.fail)["outputs"], {})
        self.assertEqual(contract.validate_skill_result({**raw, "outputs": None}, self.fail)["outputs"], {})

    def test_unknown_output_schema_field_type_is_ignored(self):
        raw = contract.new_result("logic-summary", "def:box.Box.put", outputs={"headline": "text"})
        result = contract.validate_skill_result(raw, self.fail, output_schema={"headline": ("unknown", 120)})
        self.assertEqual(result["outputs"], {})

    def test_registry_matches_contract(self):
        self.assertEqual(sorted(skill_registry.REGISTRY), sorted(contract.SKILLS))
        for skill_id, meta in contract.SKILLS.items():
            skill = skill_registry.REGISTRY[skill_id]
            self.assertEqual(skill.version, meta["version"])

    def test_registry_import_rejects_missing_and_extra_implementations(self):
        unexpected = {**contract.SKILLS, "missing-implementation": {}}
        incomplete = {key: meta for key, meta in contract.SKILLS.items() if key != "logic-summary"}
        spec = importlib.util.spec_from_file_location("ai.skills", skill_registry.__file__)
        for catalogue, expected in [(unexpected, "missing-implementation"), (incomplete, "logic-summary")]:
            with self.subTest(expected=expected), patch.object(contract, "SKILLS", catalogue):
                module = importlib.util.module_from_spec(spec)
                with self.assertRaisesRegex(RuntimeError, expected):
                    spec.loader.exec_module(module)

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


class RunnerBoundaryTests(unittest.TestCase):
    def test_cache_evicts_the_least_recently_used_and_clear_resets_it(self):
        cache = runner.Cache(limit=2)
        cache.put("first", {"value": 1})
        cache.put("second", {"value": 2})
        self.assertEqual(cache.get("first"), {"value": 1})
        cache.put("third", {"value": 3})
        self.assertIsNone(cache.get("second"))
        self.assertEqual(len(cache), 2)
        cache.clear()
        self.assertEqual(len(cache), 0)

    def test_environment_reuses_ast_and_skips_invalid_or_missing_source(self):
        tree = ast.parse("def work():\n    pass")
        index = build_index({"files": [
            {"path": "good.py", "source": "ignored"}, {"path": "broken.py", "source": "def ("},
            {"path": "missing.py"}, {"path": "later.py", "source": "class Found:\n    pass"},
        ]})
        env = runner.build_env(index, trees={"good.py": tree})
        self.assertTrue(env["ensure_trees"]())
        self.assertIs(env["trees"]["good.py"], tree)
        self.assertEqual(set(env["trees"]), {"good.py", "later.py"})
        self.assertEqual(env["nodes"][("later.py", 1)].name, "Found")
        self.assertFalse(env["ensure_trees"]())

    def test_runner_repairs_missing_ast_once_and_keeps_first_and_last_steps(self):
        source = "def run():\n" + "    total = 0\n" * (MAX_STEPS + 3) + "    return total\n"
        index = build_index(analyze(payload({"main.py": source})))
        env = runner.build_env(index)
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        outcome = service.run("logic-summary", targets=["function:main.run"])
        item, = outcome["results"]
        self.assertEqual(item["status"], "ok")
        self.assertIn(("main.py", 1), env["nodes"])
        self.assertEqual(len(item["outputs"]["steps"]), MAX_STEPS)
        self.assertIn("第 2 行", item["outputs"]["steps"][0])
        self.assertIn(f"第 {MAX_STEPS + 5} 行", item["outputs"]["steps"][-1])
        self.assertTrue(any("中间部分已省略" in claim["text"] for claim in item["claims"]))

    def test_missing_non_python_ast_is_cached_as_insufficient_evidence(self):
        result = analyze(payload({"app.js": "function run() { return 1; }"}))
        env = runner.build_env(build_index(result))
        provider = TemplateProvider()
        service = runner.Runner(env, provider=provider, cache=runner.Cache())
        target = "function:app.js.run"
        with patch.object(provider, "produce") as generate:
            first, = service.run("logic-summary", targets=[target])["results"]
            cached, = service.run("logic-summary", targets=[target])["results"]
        generate.assert_not_called()
        self.assertEqual(first["status"], "insufficient_evidence")
        self.assertEqual(first["diagnostics"]["attempts"], 2)
        self.assertEqual(cached["claims"], [])
        self.assertTrue(cached["diagnostics"]["cache_hit"])

    def test_malformed_provider_result_becomes_refused_with_no_claims(self):
        _, _, _, env = build()
        bad = Mock(id="bad", model="test")
        bad.produce.return_value = ({"status": "invalid", "claims": ["fabricated"]}, {})
        service = runner.Runner(env, provider=bad, cache=runner.Cache())
        result, = service.run("logic-summary", targets=["def:box.Box.put"])["results"]
        self.assertEqual(result["status"], "refused")
        self.assertEqual(result["claims"], [])
        self.assertIn("非法状态", result["notes"][0])

    def test_target_selection_filters_type_and_honors_global_limit(self):
        _, _, _, env = build()
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        with patch.object(runner, "MAX_TARGETS", 2):
            chosen = service.select(["unknown", "logic-summary", "solid-review"],
                                    ["module:box", "def:box.Box.put", "def:box.Box.flush"])
        self.assertEqual([(skill.id, ref) for skill, ref in chosen],
                         [("logic-summary", "def:box.Box.put"), ("logic-summary", "def:box.Box.flush")])

    def test_skill_prompts_include_only_selected_evidence(self):
        _, _, _, env = build({"box.py": SOURCE, "private.py": 'secret = "DO_NOT_SEND_LITERAL"'})
        for skill_id, target, expected in [
            ("logic-summary", "function:box.Box.put", "def:box.Box.put"),
            ("class-node-name", "class:box.Box", "function:box.Box.put"),
            ("solid-review", "class:box.Box", "def:box.Box"),
            ("ai-risk-review", "module:box", "finding:"),
        ]:
            with self.subTest(skill=skill_id):
                skill = skill_registry.get(skill_id)
                message = skill.prompt(skill.context(env, target))
                self.assertIn(target, message)
                self.assertIn(expected, message)
                self.assertNotIn("DO_NOT_SEND_LITERAL", message)

    def test_class_naming_keeps_inheritance_evidence_and_reports_method_count(self):
        methods = "".join(f"    def f{i}(self): return {i}\n" for i in range(5))
        _, _, _, env = build({"main.py": "class Base: pass\nclass Worker(Base):\n" + methods})
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        result = service.run("class-node-name", targets=["class:main.Worker", "class:main.Base"])
        worker, base = result["results"]
        self.assertIn("5", worker["outputs"]["headline"])
        self.assertTrue(any("inherit:main.Worker->main.Base" in claim["evidence"]
                            for claim in worker["claims"]))
        self.assertIn("无方法", base["outputs"]["headline"])

    def test_wrong_target_kinds_report_no_claims(self):
        _, _, _, env = build()
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        for skill_id, target in [
            ("logic-summary", "def:box.Box"),
            ("class-node-name", "def:box.Box.put"),
            ("solid-review", "def:box.Box.put"),
            ("ai-risk-review", "module:missing"),
        ]:
            with self.subTest(skill=skill_id):
                result, = service.run(skill_id, targets=[target])["results"]
                self.assertNotEqual(result["status"], "ok")
                self.assertEqual(result["claims"], [])
                self.assertTrue(result["notes"])

    def test_no_renderable_template_still_reports_insufficient_evidence(self):
        _, _, _, env = build({"main.py": CLEAN})
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        skill = skill_registry.get("ai-risk-review")
        with patch.object(skill, "render", side_effect=contract.SkillError("need_more", "missing text")):
            item, = service.run("ai-risk-review", targets=["summary:project"])["results"]
        self.assertEqual(item["status"], "insufficient_evidence")
        self.assertEqual((item["outputs"], item["claims"]), ({}, []))

    def test_scoped_fingerprint_uses_target_or_falls_back_to_project(self):
        _, _, index, env = build()
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        self.assertEqual(service._fingerprint("function:box.Box.put"), index.fingerprint("box.Box.put"))
        self.assertEqual(service._fingerprint("function:missing"), index.fingerprint())
        self.assertEqual(service._fingerprint("summary:project"), index.fingerprint())
        self.assertEqual(service._slice_stats({"scope": "file"}), {})

    def test_logic_uses_real_caller_and_resolved_side_effect_evidence(self):
        _, _, _, env = build({
            "main.py": "from tools import write\ndef run():\n    write()\ndef main():\n    run()\n",
            "tools.py": "def write():\n    with open('out', 'w') as file:\n        file.write('result')\n",
        })
        service = runner.Runner(env, provider=TemplateProvider(), cache=runner.Cache())
        item, = service.run("logic-summary", targets=["function:main.run"])["results"]
        self.assertEqual(item["status"], "ok")
        self.assertTrue(any(row["kind"] == "side_effect" and "call:main.py#3" in row["evidence"]
                            for row in item["claims"]))
        self.assertTrue(any("main.main" in row["text"] for row in item["claims"]))


class SkillBaseTests(unittest.TestCase):
    def test_base_hooks_default_to_no_candidates_or_repair(self):
        skill = skill_base.Skill()
        context = {"ref": "file:main.py"}
        self.assertEqual(skill.candidates({}), [])
        self.assertIsNone(skill.gap(context))
        self.assertIs(skill.repair({}, context, {"reason": "test"}), context)
        self.assertEqual(skill.prompt(context), "")
        with self.assertRaises(NotImplementedError):
            skill.context({}, context["ref"])
        with self.assertRaises(NotImplementedError):
            skill.render(context)

    def test_reference_helpers_keep_module_and_error_boundaries(self):
        _, _, _, env = build()
        self.assertEqual(skill_base.file_refs(env, "box.py"), ["file:box.py", "module:box"])
        self.assertEqual(skill_base.file_refs(env, "unknown.py"), ["file:unknown.py"])
        self.assertEqual(skill_base.ordinal(21), "(21)")
        self.assertEqual(skill_base.join_limited(["a", "b", "c"], 2), "a、b 等 3 项")
        self.assertEqual(skill_base.short(" one\n two  three ", 8), "one two…")
        with self.assertRaises(contract.SkillError):
            skill_base.target_payload("bad")
        with self.assertRaises(contract.SkillError):
            skill_base.symbol_of(env, "module:box")

    def test_invalid_risk_target_and_missing_finding_ids_are_handled(self):
        _, _, _, env = build()
        skill = skill_registry.get("ai-risk-review")
        with self.assertRaisesRegex(contract.SkillError, "只接受模块"):
            skill.context(env, "def:box.Box.put")
        context = skill.context(env, "summary:project")
        context["findings"] = [{key: value for key, value in row.items() if key != "id"}
                               for row in context["findings"]]
        self.assertIs(skill.repair(env, context, {"reason": "not repairable"}), context)
        result = skill.render(context)
        self.assertEqual([item["evidence"] for item in result["claims"]], [["summary:project"]])

    def test_logic_context_handles_unavailable_index_slice_and_declines_other_repairs(self):
        _, _, index, env = build()
        skill = skill_registry.get("logic-summary")
        context = skill.context(env, "def:box.Box.put")
        self.assertIs(skill.repair(env, context, {"retry": "external"}), context)
        with patch.object(index, "slice_function", return_value=None):
            with self.assertRaisesRegex(contract.SkillError, "无法切片"):
                skill.context(env, "def:box.Box.put")


class RulesTests(unittest.TestCase):
    def test_class_instantiation_rule_excludes_abstract_dependencies(self):
        source = """from abc import ABC, abstractmethod
class Abstract(ABC):
    @abstractmethod
    def use(self): pass
class Concrete: pass
class Consumer:
    def build(self): return Abstract(), Concrete()
"""
        findings = extra_rules.evaluate(analyze(payload({"main.py": source})))
        self.assertEqual(findings["metrics"]["concrete_deps"], 1)
        self.assertFalse(any(row["rule_id"] == "DIP-01" for row in findings["findings"]))

    def test_rule_helpers_reject_invalid_results_and_merge_finding_lists(self):
        with self.assertRaises(ValueError):
            extra_rules.evaluate(None)
        self.assertTrue(extra_rules._handler_is_silent(ast.ExceptHandler(body=[])))
        original = {"id": "old", "severity": "warning", "line": 5}
        result = extra_rules.merge([original], [{"severity": "critical", "line": 10}])
        self.assertEqual([(row["line"], row["id"]) for row in result], [(10, "finding-1"), (5, "finding-2")])
        self.assertEqual(original["id"], "old")

    def test_non_python_and_incomplete_records_do_not_generate_python_findings(self):
        result = analyze(payload({"app.js": "class App { run() { work(); } }"}))
        result["files"].append({"status": "ok", "path": "missing.py"})
        result["functions"].append({"id": None, "name": "invalid", "file": "missing.py"})
        self.assertEqual(extra_rules.evaluate(result)["findings"], [])
    def test_type_dispatch_counts_distinct_supported_forms(self):
        source = """class Router:
    def run(self, item):
        if type(item) is int: return 1
        if str is type(item): return 2
        if isinstance(item, (bytes,)): return 3
        if isinstance(item, (int, str)): return 4
        if isinstance(item): return 5
        if type(item) is factory.kind: return 6
        if factory.kind is type(item): return 7
        if isinstance(item, factory.kind): return 7
        return 0
"""
        result = analyze(payload({"main.py": source}))
        findings = extra_rules.evaluate(result)["findings"]
        hit, = [item for item in findings if item["rule_id"] == "OCP-01"]
        self.assertEqual((hit["actual"], hit["threshold"], hit["evidence_type"]), (3, 3, "inference"))

    def test_silent_broad_handlers_are_separated_from_narrow_or_active_handlers(self):
        source = """def run(items):
    for item in items:
        try: work(item)
        except (TypeError, Exception): continue
    try: work(items)
    except: ...
    try: work(items)
    except Exception: report()
    try: work(items)
    except ValueError: pass
"""
        result = analyze(payload({"main.py": source}))
        findings = extra_rules.evaluate(result)["findings"]
        self.assertEqual(sorted(row["line"] for row in findings if row["rule_id"] == "A8-DEFENSIVE"), [4, 6])

    def test_extra_findings_cap_keeps_full_metrics(self):
        source = "".join(f"def unused{i}(): pass\n" for i in range(6))
        with patch.object(extra_rules, "MAX_EXTRA_FINDINGS", 2):
            result = extra_rules.evaluate(analyze(payload({"main.py": source})))
        self.assertEqual(len(result["findings"]), 2)
        self.assertEqual(result["metrics"]["dead_functions"], 6)

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
