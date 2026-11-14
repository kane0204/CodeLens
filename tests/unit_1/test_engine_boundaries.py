"""Ten regression cases for engine boundaries not covered by test_engine.py.

Each case asserts on real analyze() output or a pure helper; no fallback data.
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import (MAX_FILE_BYTES, analyze, code_line_numbers, cycles_of,
                                module_name, normalized_path, rank)

NL = chr(10)


def run_files(files):
    return analyze({"project": "boundary-test",
                    "files": [{"path": p, "content": s} for p, s in files.items()]})


def if_chain(count):
    return "def f(x):" + NL + "".join(
        "    if x > %d:" % i + NL + "        x += 1" + NL for i in range(count))


def assignment_chain(count):
    return "def g(x):" + NL + "".join("    x += %d" % i + NL for i in range(count))


def nested_ifs(depth):
    src = "def h(x):" + NL
    for level in range(depth):
        src += "    " * (level + 1) + "if x:" + NL
    return src + "    " * (depth + 1) + "return x" + NL


class EngineBoundaryTests(unittest.TestCase):

    # 1. CC-01: threshold is strict ">", severity escalates above 20.
    def test_cc_threshold_and_severity_boundaries(self):
        at_limit = run_files({"a.py": if_chain(9)})
        over_limit = run_files({"a.py": if_chain(10)})
        critical = run_files({"a.py": if_chain(20)})
        self.assertEqual(at_limit["functions"][0]["cc"], 10)
        self.assertEqual(at_limit["findings"], [])
        hits = [f for f in over_limit["findings"] if f["rule_id"] == "CC-01"]
        self.assertEqual(len(hits), 1)
        self.assertEqual((hits[0]["actual"], hits[0]["threshold"], hits[0]["severity"]),
                         (11, 10, "warning"))
        self.assertEqual(critical["functions"][0]["cc"], 21)
        self.assertEqual(next(f for f in critical["findings"]
                              if f["rule_id"] == "CC-01")["severity"], "critical")

    # 2. LEN-01 / DEPTH-01: only values strictly above the configured limit fire.
    def test_length_and_nesting_threshold_boundaries(self):
        len_at = run_files({"a.py": assignment_chain(49)})
        len_over = run_files({"a.py": assignment_chain(50)})
        self.assertEqual(len_at["functions"][0]["length"], 50)
        self.assertEqual(len_at["findings"], [])
        long_hits = [f for f in len_over["findings"] if f["rule_id"] == "LEN-01"]
        self.assertEqual([(f["actual"], f["threshold"]) for f in long_hits], [(51, 50)])

        shallow = run_files({"a.py": nested_ifs(4)})
        deep = run_files({"a.py": nested_ifs(5)})
        self.assertEqual(shallow["functions"][0]["nesting"], 4)
        self.assertEqual(shallow["findings"], [])
        deep_hits = [f for f in deep["findings"] if f["rule_id"] == "DEPTH-01"]
        self.assertEqual([(f["actual"], f["threshold"]) for f in deep_hits], [(5, 4)])

    # 3. Length uses physical code lines: comments, blanks and docstrings excluded.
    def test_physical_code_lines_exclude_comments_and_docstrings(self):
        source = ("def f(x):" + NL
                  + "    \"\"\"docs" + NL
                  + "    more\"\"\"" + NL
                  + "    # comment" + NL
                  + NL
                  + "    x += 1" + NL
                  + "    return x" + NL)
        result = run_files({"a.py": source})
        self.assertEqual(sorted(code_line_numbers(source)), [1, 2, 3, 6, 7])
        self.assertEqual(result["functions"][0]["length"], 3)
        self.assertEqual(result["summary"]["code_lines"], 3)
        statement_lines = [s["line"] for s in result["functions"][0]["statements"]]
        self.assertNotIn(4, statement_lines)
        self.assertNotIn(5, statement_lines)

    # 4. CC counts comprehensions, boolean operators and non-wildcard match cases.
    def test_complexity_counts_comprehensions_boolops_and_match_cases(self):
        comprehension = run_files({"a.py": """def f(x):
    return [i for i in x if i and (i or i)]
"""})
        self.assertEqual(comprehension["functions"][0]["cc"], 5)
        match = run_files({"a.py": """def g(x):
    match x:
        case 1:
            return 1
        case 2:
            return 2
        case _:
            return 0
"""})
        self.assertEqual(match["functions"][0]["cc"], 3)
        self.assertEqual(match["findings"], [])

    # 5. Rank cut-offs and path/module normalisation, including traversal rejection.
    def test_rank_boundaries_and_path_module_normalisation(self):
        self.assertEqual([rank(n) for n in (5, 6, 10, 11, 20, 21, 30, 31, 40, 41)],
                         ["A", "B", "B", "C", "C", "D", "D", "E", "E", "F"])
        self.assertEqual([module_name(p) for p in ("a.py", "pkg/sub.py", "pkg/__init__.py")],
                         ["a", "pkg.sub", "pkg"])
        self.assertEqual(normalized_path("pkg\\sub.py"), "pkg/sub.py")
        for bad in ("", "../a.py", "/a.py", "C:/a.py", "a" + chr(0) + ".py", "a" * 1025):
            with self.subTest(path=bad), self.assertRaises(ValueError):
                normalized_path(bad)

    # 6. Ambiguous bindings produce warnings and unresolved calls, never guesses.
    def test_ambiguous_symbols_warn_instead_of_guessing(self):
        star = run_files({"b.py": """def go():
    pass
""", "a.py": """from b import *
go()
"""})
        self.assertTrue(any("星号导入" in w["message"] for w in star["warnings"]))
        self.assertEqual([(c["target"], c["status"]) for c in star["graph"]["calls"]],
                         [(None, "unresolved")])

        duplicate = run_files({"a.py": """def go():
    pass
def go():
    pass
def f():
    go()
"""})
        self.assertTrue(any("重复定义名称" in w["message"] for w in duplicate["warnings"]))
        self.assertEqual([(c["target"], c["status"]) for c in duplicate["graph"]["calls"]],
                         [(None, "unresolved")])

    # 7. A4 ignores placeholders and short values; real values stay redacted.
    def test_secret_rule_ignores_placeholders_and_short_values(self):
        result = run_files({"a.py": """api_key = "DEMO_PLACEHOLDER"
token = "abcdefghij"
password = "short"
"""})
        hits = [f for f in result["findings"] if f["rule_id"] == "A4"]
        self.assertEqual([f["line"] for f in hits], [2])
        # The finding must never carry the literal; files[].source is the user's own input.
        self.assertNotIn("abcdefghij", json.dumps(hits, ensure_ascii=False))
        self.assertEqual(result["summary"]["findings"], len(result["findings"]))

    # 8. A bare or Exception handler protects open(); only the unprotected call fires.
    def test_bare_and_generic_exception_handlers_protect_io(self):
        result = run_files({"a.py": """def f():
    try:
        open('a')
    except:
        pass
def g():
    try:
        open('b')
    except Exception:
        pass
def h():
    open('c')
"""})
        hits = [f for f in result["findings"] if f["rule_id"] == "A3-IO"]
        self.assertEqual([f["line"] for f in hits], [12])
        self.assertTrue(all(f["evidence_type"] == "inference" for f in hits))

    # 9. Self-import and three-module cycles are both reported once.
    def test_self_and_three_module_cycles_are_reported(self):
        self_cycle = run_files({"a.py": """import a
"""})
        self.assertEqual(self_cycle["graph"]["cycles"], [["a"]])
        self.assertEqual([f["rule_id"] for f in self_cycle["findings"]], ["CYCLE-01"])

        triangle = run_files({"a.py": """import b
""", "b.py": """import c
""", "c.py": """import a
"""})
        self.assertEqual(triangle["graph"]["cycles"], [["a", "b", "c"]])
        self.assertEqual(len([f for f in triangle["findings"]
                              if f["rule_id"] == "CYCLE-01"]), 1)
        self.assertEqual(cycles_of(["a", "b", "c", "d"],
                                   [("a", "a"), ("b", "c"), ("c", "b"), ("c", "d")]),
                         [["a"], ["b", "c"]])

    # 10. Mixed-language scan declares its limits; malformed payloads degrade safely.
    def test_mixed_language_scan_and_payload_guards(self):
        mixed = run_files({"a.py": """def f():
    return 1
""", "b.js": """function g(){ if(x) return 1; }
""", "c.go": """package main
func h() {}
""", "note.txt": "hi"})
        self.assertEqual(mixed["summary"]["files"], 3)
        self.assertEqual(mixed["summary"]["excluded"], 1)
        self.assertEqual(mixed["config"]["languages"], ["Go", "JavaScript", "Python 3.11"])
        self.assertTrue(any("非 Python" in text for text in mixed["limitations"]))

        with self.assertRaises(ValueError):
            analyze({})
        with self.assertRaises(ValueError):
            analyze({"files": [{"path": "a.py", "content": "pass"},
                               {"path": "a/__init__.py", "content": ""}]})
        with self.assertRaises(ValueError):
            analyze({"files": [{"path": "m%d.py" % i, "content": "x" * (1024 * 1024)}
                               for i in range(9)]})
        for item in ({"path": "a.py"},
                     {"path": "a.py", "content": 123},
                     {"path": "a.py", "content_base64": "!!!"},
                     {"path": "a.py", "content": "x" * (MAX_FILE_BYTES + 1)}):
            with self.subTest(item=item):
                result = analyze({"files": [item]})
                self.assertEqual(result["status"], "failed")
                self.assertIsNone(result["summary"]["average_cc"])
                self.assertEqual(result["errors"][0]["file"], "a.py")


if __name__ == "__main__":
    unittest.main(verbosity=2)
