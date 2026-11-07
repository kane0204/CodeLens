"""Regression tests use synthetic assertions, never application fallback data."""
import base64
import json
import sys
import uuid
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine import engine
from core_engine.engine import analyze, MAX_FILES


def run_files(files):
    return analyze({"project":"unit-test","files":[{"path":p,"content":s} for p,s in files.items()]})


class EngineTests(unittest.TestCase):
    def test_invalid_file_records_and_duplicate_modules_are_rejected(self):
        for record in (None, {"path": None}, {"path": "x" * 1025}):
            with self.subTest(record=record), self.assertRaises(ValueError):
                analyze({"files": [record]})
        with self.assertRaisesRegex(ValueError, "同名模块"):
            run_files({"pkg.py": "pass", "pkg/__init__.py": "pass"})

    def test_invalid_base64_missing_content_and_oversized_files_are_isolated(self):
        files = [
            {"path": "valid.py", "content": "pass"},
            {"path": "malformed.py", "content_base64": "==?"},
            {"path": "missing.py"},
            {"path": "too_large.py", "content": "# " + "x" * 30},
        ]
        with patch.object(engine, "MAX_FILE_BYTES", 30):
            result = analyze({"files": files})
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["summary"]["parsed"], 1)
        self.assertEqual({item["file"] for item in result["errors"]}, {"malformed.py", "missing.py", "too_large.py"})

    def test_total_size_is_checked_across_files_and_is_inclusive(self):
        with patch.object(engine, "MAX_TOTAL_BYTES", 8):
            self.assertEqual(run_files({"a.py": "pass", "b.py": "pass"})["status"], "complete")
            with self.assertRaisesRegex(ValueError, "源码总量"):
                run_files({"a.py": "pass\n", "b.py": "pass"})

    def test_non_python_failure_does_not_remove_valid_python_output(self):
        with patch.object(engine.generic, "analyze_record", side_effect=ValueError("lexer error")):
            result = run_files({"app.js": "function run() {}", "main.py": "def run():\n    return 1\n"})
        self.assertEqual(result["status"], "partial")
        self.assertEqual([fn["id"] for fn in result["functions"]], ["main.run"])
        self.assertEqual(result["errors"][0]["file"], "app.js")

    def test_python_failure_after_symbol_collection_excludes_stale_import_edges(self):
        count = engine.code_line_numbers

        def metrics(source):
            if source.startswith("import good"):
                raise MemoryError("metrics unavailable")
            return count(source)

        with patch.object(engine, "code_line_numbers", side_effect=metrics):
            result = run_files({"bad.py": "import good\ndef broken(): pass", "good.py": "def run(): pass"})
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["graph"]["dependencies"], [])
        self.assertEqual([row["id"] for row in result["functions"]], ["good.run"])

    def test_invalid_non_python_utf8_is_decoded_without_losing_the_other_bytes(self):
        result = analyze({"files": [{"path": "main.js",
                                     "content_base64": base64.b64encode(b"// \xff\nfunction run() {}").decode()}]})
        self.assertEqual(result["status"], "complete")
        self.assertIn("\ufffd", result["files"][0]["source"])
        self.assertEqual(result["functions"][0]["name"], "run")

    def test_match_complexity_excludes_default_case(self):
        result = run_files({"main.py": """def route(value):
    match value:
        case 1: return "first"
        case 2: return "second"
        case _: return "default"
"""})
        self.assertEqual(result["functions"][0]["cc"], 3)

    def test_cpp_inheritance_links_only_known_classes(self):
        result = run_files({"base.hpp": "class Base {};",
                            "worker.cpp": "class Worker : public Base, private External {};"})
        self.assertEqual([(edge["source"], edge["target"]) for edge in result["graph"]["inheritance"]],
                         [("worker.cpp.Worker", "base.hpp.Base")])

    def test_duplicate_definitions_and_star_import_do_not_invent_targets(self):
        result = run_files({
            "main.py": "from helper import *\ndef work(): pass\ndef work(): pass\ndef run():\n    work()\n    utility()\n",
            "helper.py": "def utility(): pass\n",
        })
        self.assertEqual({fn["id"] for fn in result["functions"] if fn["name"] == "work"},
                         {"main.work", "main.work@3"})
        self.assertEqual({warning["line"] for warning in result["warnings"] if warning["file"] == "main.py"}, {1, 3})
        self.assertEqual([(edge["expression"], edge["status"]) for edge in result["graph"]["calls"]],
                         [("work", "unresolved"), ("utility", "unresolved")])

    def test_lambda_parameters_do_not_shadow_outer_calls(self):
        result = run_files({"main.py": """def helper(): pass
def run():
    inline = lambda value, *helper, **kwargs: helper()
    return helper()
"""})
        calls = [edge for edge in result["graph"]["calls"] if edge["expression"] == "helper"]
        self.assertEqual([(edge["line"], edge["status"]) for edge in calls], [(3, "unresolved"), (4, "resolved")])

    def test_bare_except_protects_open_inside_its_try_body(self):
        result = run_files({"main.py": """def run():
    try:
        open("source.txt")
    except:
        recover()
"""})
        self.assertFalse(any(item["rule_id"] == "A3-IO" for item in result["findings"]))

    def test_io_handler_tuple_can_match_builtin_after_qualified_exception(self):
        result = run_files({"main.py": """def run():
    try:
        open("source.txt")
    except (errors.CustomError, OSError):
        recover()
"""})
        self.assertFalse(any(item["rule_id"] == "A3-IO" for item in result["findings"]))

    def test_rejects_oversized_ast_and_keeps_other_file(self):
        result = run_files({"large.py": "x=1\n" * 25_000, "good.py": "def run(): return 1"})
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["summary"]["parsed"], 1)
        self.assertEqual(result["errors"][0]["file"], "large.py")
        self.assertEqual(result["errors"][0]["type"], "ValueError")

    def test_partial_tokenization_keeps_code_lines_seen_before_the_error(self):
        self.assertEqual(engine.code_line_numbers("x = 1\ncall(\n"), {1, 2})

    def test_mixed_case_python_extension_uses_ast_and_resolves_imports(self):
        result = run_files({
            "main.PY": "from helper import work\ndef run():\n    return work()\n",
            "helper.Py": "def work():\n    return 1\n",
        })
        self.assertEqual(result["status"], "complete")
        self.assertEqual({record["language"] for record in result["files"]}, {"Python 3.11"})
        functions = {fn["id"]: fn for fn in result["functions"]}
        self.assertEqual(set(functions), {"main.run", "helper.work"})
        self.assertEqual(functions["main.run"]["statements"][0]["line"], 3)
        self.assertEqual([(call["source"], call["target"]) for call in result["graph"]["calls"]],
                         [("main.run", "helper.work")])

    def test_empty_is_empty(self):
        r=run_files({})
        self.assertEqual(r["status"],"empty")
        self.assertEqual(r["summary"]["functions"],0)
        self.assertIsNone(r["summary"]["average_cc"])

    def test_real_metrics_and_lines(self):
        r=run_files({"main.py":"def score(x):\n    if x > 0:\n        return x\n    return 0\n"})
        f=r["functions"][0]
        self.assertEqual((f["cc"],f["length"],f["line"],f["end_line"]),(2,4,1,4))
        self.assertEqual([s["line"] for s in f["statements"]],[2,3,4])
        self.assertEqual(r["summary"]["files"],1)

    def test_metrics_change_with_input(self):
        a=run_files({"a.py":"def f(x):\n    return x\n"})
        b=run_files({"a.py":"def f(x):\n    if x:\n        return x\n    return 0\n"})
        self.assertNotEqual(a["functions"][0]["cc"],b["functions"][0]["cc"])
        self.assertNotEqual(a["files"][0]["sha256"],b["files"][0]["sha256"])

    def test_partial_syntax_error(self):
        r=run_files({"good.py":"def ok():\n    return 1\n","bad.py":"def ("})
        self.assertEqual(r["status"],"partial")
        self.assertEqual(r["summary"]["parsed"],1)
        self.assertEqual(len(r["errors"]),1)
        self.assertEqual(r["errors"][0]["file"],"bad.py")

    def test_all_fail_is_not_success(self):
        r=run_files({"bad.py":"def ("})
        self.assertEqual(r["status"],"failed")
        self.assertIsNone(r["summary"]["average_cc"])

    def test_exclusions(self):
        r=run_files({"main.py":"pass", "tests/test_x.py":"pass", ".venv/a.py":"pass", "a.md":"hi"})
        self.assertEqual(r["summary"]["files"],1)
        self.assertEqual(r["summary"]["excluded"],3)

    def test_not_executed(self):
        target=Path(__file__).resolve().parents[2]/("must-not-exist-"+uuid.uuid4().hex+".txt")
        source=f"from pathlib import Path\nPath({str(target)!r}).write_text('side effect')\nraise RuntimeError('never run')\n"
        r=run_files({"effect.py":source})
        self.assertEqual(r["status"],"complete")
        self.assertFalse(target.exists())

    def test_dependencies_cycles_and_calls(self):
        r=run_files({"a.py":"from b import go\ndef start():\n    go()\n", "b.py":"import a\ndef go():\n    pass\n"})
        self.assertEqual(r["graph"]["cycles"],[["a","b"]])
        c=r["graph"]["calls"][0]
        self.assertEqual((c["source"],c["target"],c["line"]),("a.start","b.go",3))
        self.assertEqual(len([f for f in r["findings"] if f["rule_id"]=="CYCLE-01"]),1)

    def test_relative_import_and_class(self):
        r=run_files({"pkg/__init__.py":"", "pkg/base.py":"class Base:\n    pass\n", "pkg/sub.py":"from .base import Base\nclass Child(Base):\n    pass\n"})
        e=r["graph"]["inheritance"][0]
        self.assertEqual((e["source"],e["target"]),("pkg.sub.Child","pkg.base.Base"))

    def test_module_attribute_call(self):
        r=run_files({"pkg/b.py":"def f():\n    pass\n", "a.py":"import pkg.b\npkg.b.f()\n"})
        self.assertEqual(r["graph"]["calls"][0]["target"],"pkg.b.f")

    def test_selected_package_root_relative_import(self):
        r=run_files({"__init__.py":"", "a.py":"from .b import f\nf()\n", "b.py":"def f():\n    pass\n"})
        self.assertEqual(r["graph"]["calls"][0]["target"],"b.f")

    def test_parameter_shadowed_import_is_unresolved(self):
        r=run_files({"b.py":"def go():\n    pass\n", "a.py":"from b import go\ndef f(go):\n    go()\n"})
        self.assertEqual(r["graph"]["calls"][0]["status"],"unresolved")

    def test_assignment_shadowed_function_is_unresolved(self):
        r=run_files({"a.py":"def go():\n    pass\ndef f():\n    go = object()\n    go()\n"})
        self.assertTrue(all(c["target"] is None for c in r["graph"]["calls"]))

    def test_no_class_scope_as_method_lexical_binding(self):
        r=run_files({"a.py":"class C:\n    def x(self):\n        pass\n    def y(self):\n        x()\n"})
        self.assertIsNone(r["graph"]["calls"][0]["target"])

    def test_nested_functions_metrics_separate(self):
        r=run_files({"a.py":"def outer():\n    def inner(x):\n        if x:\n            return 1\n        return 0\n    return inner(1)\n"})
        self.assertEqual([f["cc"] for f in r["functions"]],[1,2])

    def test_io_protected_and_unprotected(self):
        r=run_files({"a.py":"def f():\n    open('a')\n    try:\n        open('b')\n    except OSError:\n        pass\n    with open('c') as f:\n        pass\n"})
        io=[f for f in r["findings"] if f["rule_id"]=="A3-IO"]
        self.assertEqual([f["line"] for f in io],[2,7])
        self.assertTrue(all(f["evidence_type"]=="inference" for f in io))

    def test_io_wrong_exception_and_finally(self):
        r=run_files({"a.py":"try:\n    open('a')\nexcept ValueError:\n    pass\nfinally:\n    open('b')\n"})
        self.assertEqual(len([f for f in r["findings"] if f["rule_id"]=="A3-IO"]),2)

    def test_io_shadowed_builtin(self):
        r=run_files({"a.py":"def f(open):\n    open('a')\n"})
        self.assertEqual(r["findings"],[])

    def test_hardcoded_secret_pattern_redaction(self):
        value="fixture-credential-only-987654"
        r=run_files({"a.py":f"api_key = {value!r}\ntoken = 'DEMO_TOKEN_NOT_REAL'\npassword = ''\n"})
        fs=[f for f in r["findings"] if f["rule_id"]=="A4"]
        self.assertEqual(len(fs),1)
        self.assertNotIn(value,json.dumps(fs))

    def test_deterministic(self):
        files={"b.py":"def go(x):\n    return x\n", "a.py":"from b import go\ngo(1)\n"}
        a=run_files(files)
        b=run_files(dict(reversed(list(files.items()))))
        self.assertEqual(json.dumps(a,ensure_ascii=False),json.dumps(b,ensure_ascii=False))

    def test_encoding_cookie(self):
        raw='# coding: latin-1\nname = "café"\n'.encode('latin-1')
        r=analyze({"files":[{"path":"a.py","content_base64":base64.b64encode(raw).decode()}]})
        self.assertEqual(r["status"],"complete")
        self.assertIn('café',r["files"][0]["source"])

    def test_duplicate_or_unsafe_paths_rejected(self):
        for path in ['../a.py','C:/a.py','/a.py']:
            with self.assertRaises(ValueError):
                run_files({path:'pass'})
        with self.assertRaises(ValueError):
            analyze({"files":[{"path":"a.py","content":"pass"}]*2})

    def test_file_count_limit(self):
        with self.assertRaises(ValueError):
            run_files({f"m{i}.py":"pass" for i in range(MAX_FILES+1)})


if __name__=="__main__":
    unittest.main(verbosity=2)
