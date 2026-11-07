"""Regression tests for the non-Python static analyzer."""
import json
import sys
import unittest
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine import generic
from core_engine.engine import analyze


def analyze_source(path, source, known_paths=()):
    record = {"path": path, "module": path, "source": dedent(source)}
    return generic.analyze_record(record, known_paths)


class GenericAnalyzerTests(unittest.TestCase):
    def test_java_interface_bases_and_unfinished_classes_are_kept_separate(self):
        result = analyze_source("Task.java", """
            package demo;
            interface Task extends Runnable, AutoCloseable {
              void run() {}
            }
            class Incomplete {
            """)
        task, = result["classes"]
        self.assertEqual((task["name"], task["bases"]), ("Task", ["Runnable", "AutoCloseable"]))
        self.assertEqual(result["dependencies"], [])

    def test_duplicate_class_names_on_different_lines_get_distinct_ids(self):
        result = analyze_source("widget.cpp", """\
            namespace a { class Worker {}; }
            namespace b { class Worker {}; }
            """)
        self.assertEqual([row["id"] for row in result["classes"]], ["widget.cpp.Worker", "widget.cpp.Worker@2"])

    def test_non_function_braces_do_not_create_symbols_for_incomplete_headers(self):
        for source in ("*() {}", "return(x) {}", "obj.method() {}"):
            with self.subTest(source=source):
                self.assertEqual(analyze_source("broken.js", source)["functions"], [])
        self.assertEqual(generic._params_of("no parameter list"), 0)
        self.assertEqual(generic._kept_ranges(5, 15, [(1, 6), (7, 9), (12, 15)]), [(5, 7), (9, 15)])

    def test_three_cpp_overloads_on_one_line_keep_distinct_symbols(self):
        source = "int work() {return 0;} int work(int x) {return x;} int work(int x, int y) {return x + y;}"
        result = analyze_source("worker.cpp", source)
        self.assertEqual([row["params"] for row in result["functions"]], [0, 1, 2])
        self.assertEqual(len({row["id"] for row in result["functions"]}), 3)
    def test_comments_and_strings_do_not_affect_metrics_or_calls(self):
        result = analyze_source("score.ts", """\
            function helper(x: number) {
              return x;
            }
            function score(x: number, enabled: boolean) {
              // if (bogus()) { }
              const label = "if (phantom()) {";
              if (enabled && x > 0) {
                return helper(x);
              }
              return external(x);
            }
            """)

        self.assertEqual([item["name"] for item in result["functions"]], ["helper", "score"])
        score = result["functions"][1]
        self.assertEqual((score["line"], score["end_line"], score["length"]), (4, 11, 7))
        # Base path + if + short-circuit condition, with one control block.
        self.assertEqual((score["cc"], score["nesting"], score["params"]), (3, 1, 2))
        self.assertEqual(
            [(edge["target"], edge["expression"], edge["line"], edge["status"])
             for edge in result["calls"]],
            [("score.ts.helper", "helper", 8, "resolved"),
             (None, "external", 10, "unresolved")],
        )

    def test_internal_and_external_dependencies_across_language_families(self):
        cases = [
            ("src/main.cpp", '#include "math.hpp"\n#include <vector>\n',
             "src/math.hpp", "vector", (1, 2)),
            ("src/Main.java", "import app.Helper;\nimport java.util.List;\n",
             "src/app/Helper.java", "java.util.List", (1, 2)),
            ("src/app/main.ts", 'import { helper } from "../utils";\nimport x from "pkg";\n',
             "src/utils/index.ts", "pkg", (1, 2)),
            ("main.go", 'import (\n  "app/helper"\n  "fmt"\n)\n',
             "app/helper.go", "fmt", (2, 3)),
        ]
        for path, source, internal, external, lines in cases:
            with self.subTest(path=path):
                edges = analyze_source(path, source, [path, internal])["dependencies"]
                self.assertEqual(
                    [(edge["source"], edge["target"], edge["line"], edge["internal"])
                     for edge in edges],
                    [(path, internal, lines[0], True), (path, external, lines[1], False)],
                )

    def test_secret_finding_omits_value_and_ignores_placeholder(self):
        secret = "s3cr3t-123456"
        findings = analyze_source("config.js", f"""\
            const apiKey = "{secret}";
            const token = "example-placeholder";
            """)["findings"]

        self.assertEqual([(item["rule_id"], item["line"]) for item in findings], [("A4", 1)])
        self.assertNotIn(secret, json.dumps(findings))

    def test_engine_keeps_both_analysis_paths_in_mixed_project(self):
        result = analyze({"files": [
            {"path": "main.py", "content": "def main():\n    return 1\n"},
            {"path": "helper.go", "content": "func helper() int {\n    return 2\n}\n"},
        ]})

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["summary"]["languages"], {"Python 3.11": 1, "Go": 1})
        functions = {item["file"]: item for item in result["functions"]}
        self.assertEqual(set(functions), {"main.py", "helper.go"})
        self.assertEqual(functions["main.py"]["statements"][0]["line"], 2)
        self.assertEqual(functions["helper.go"]["statements"], [])

    def test_cpp_methods_and_overloads_keep_distinct_symbols(self):
        result = analyze_source("widget.cpp", """\
            #include "widget.hpp"
            class Worker : public Base {
            public:
              int run(void) {
                return work();
              }
            private:
              int _unused(void) {
                return 0;
              }
            };
            int work(int x) { return x; }
            int work() { return 0; }
            """, ["include/Widget.hpp"])
        worker, = result["classes"]
        self.assertEqual(worker["bases"], ["Base"])
        self.assertEqual(worker["methods"], ["widget.cpp.Worker.run", "widget.cpp.Worker._unused"])
        self.assertEqual([f["params"] for f in result["functions"]], [0, 0, 1, 0])
        self.assertEqual(len({f["id"] for f in result["functions"]}), 4)
        call, = result["calls"]
        self.assertEqual((call["expression"], call["status"], call["target"]), ("work", "unresolved", None))
        finding, = result["findings"]
        self.assertEqual((finding["rule_id"], finding["evidence_type"]), ("A5-DEAD", "inference"))
        self.assertEqual(result["dependencies"][0]["target"], "include/Widget.hpp")

    def test_javascript_nested_functions_have_separate_metrics_and_call_sites(self):
        result = analyze_source("app.js", r"""
            const outer = (x) => {
              /* { bogus(); }
                 if (other()) {} */
              function inner(y) {
                if (y) { return actual(); }
                return 0;
              }
              const text = "escaped \" bogus()";
              return inner(x);
            }
            """)
        outer, inner = result["functions"]
        self.assertEqual((outer["name"], outer["cc"], outer["nesting"]), ("outer", 1, 0))
        self.assertEqual((inner["name"], inner["cc"], inner["nesting"]), ("inner", 2, 1))
        self.assertIn(("app.js.inner", "actual"), {(edge["source"], edge["expression"]) for edge in result["calls"]})
        self.assertFalse({"bogus", "other"} & {edge["expression"] for edge in result["calls"]})

    def test_thresholds_and_line_rules_report_values_and_evidence(self):
        conditions = " && ".join(["flag"] * 17)
        source = f"function run(flag) {{\nif ({conditions}) {{\n" + "if (flag) {\n" * 4
        source += "work();\n" * 51 + "}\n" * 5 + "\n}\n"
        source += "try { run(); } catch (Error e) {}\n"
        source += "try { run(); } catch (Exception e) { handle(e); }\n// TODO unfinished\n"
        findings = analyze_source("app.js", source)["findings"]
        self.assertEqual([(item["rule_id"], item["actual"], item["threshold"]) for item in findings[:3]],
                         [("CC-01", 22, 10), ("LEN-01", 63, 50), ("DEPTH-01", 5, 4)])
        self.assertEqual(findings[0]["severity"], "critical")
        self.assertEqual([(item["rule_id"], item["severity"]) for item in findings[3:]],
                         [("A8-DEFENSIVE", "warning"), ("A8-DEFENSIVE", "info"), ("CMT-01", "info")])

    def test_call_limit_applies_to_the_whole_file(self):
        source = "function first() { a(); b(); c(); d(); }\nfunction second() { e(); }"
        with patch.object(generic, "MAX_CALLS_PER_FILE", 3):
            calls = analyze_source("app.js", source)["calls"]
        self.assertEqual([edge["expression"] for edge in calls], ["a", "b", "c"])
