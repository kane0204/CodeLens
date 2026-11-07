"""Check the evidence index through real static analysis results."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import analyze
from core_engine.ir import MAX_STATEMENTS_PER_FUNCTION, build_index


def index_for(files):
    return build_index(analyze({"files": [{"path": path, "content": source} for path, source in files.items()]}))


class EvidenceIndexTests(unittest.TestCase):
    def setUp(self):
        self.files = {
            "a.py": "from b import Base\nclass Worker(Base):\n    def run(self):\n        return work()\ndef work():\n    return open('input')\n",
            "b.py": "import a\nclass Base:\n    pass\n",
        }
        self.index = index_for(self.files)

    def test_resolves_every_supported_evidence_kind(self):
        finding = next(item for item in self.index.findings.values() if item["rule_id"] == "A3-IO")
        cases = {
            "summary:project": {"payload": "project"},
            "file:a.py": {"path": "a.py", "sha256": self.index.files["a.py"]["sha256"]},
            "module:a": {"module": "a", "path": "a.py"},
            "def:a.Worker": {"id": "a.Worker", "symbol_kind": "class"},
            "function:a.Worker.run": {"id": "a.Worker.run"},
            "class:b.Base": {"id": "b.Base"},
            "line:a.py#6": {"path": "a.py", "line": 6},
            "stmt:a.Worker.run#4": {"id": "a.Worker.run", "line": 4, "ast_type": "Return"},
            f"finding:{finding['id']}": {"id": finding["id"], "rule_id": "A3-IO"},
            "dep:a->b": {"source": "a", "target": "b"},
            "call:a.py#4": {"path": "a.py", "line": 4},
            "inherit:a.Worker->b.Base": {"source": "a.Worker", "target": "b.Base"},
        }
        for ref, fields in cases.items():
            with self.subTest(ref=ref):
                self.assertEqual(self.index.resolve(ref), {"ok": True, "kind": ref.split(":")[0], **fields})

    def test_first_cycle_can_be_referenced_at_index_zero(self):
        self.assertEqual(self.index.resolve("cycle:0"), {
            "ok": True, "kind": "cycle", "index": 0, "modules": ["a", "b"],
        })
        self.assertFalse(self.index.resolve("cycle:1")["ok"])
        self.assertFalse(self.index.resolve("cycle:-1")["ok"])
        self.assertFalse(self.index.resolve("line:a.py#0")["ok"])

    def test_bad_references_return_reason_and_do_not_prevent_valid_references(self):
        invalid = [
            None, "", "x" * 513, "file", ":a.py", "file:", "file:a:py", "summary:file",
            "file:missing.py", "module:missing", "def:missing", "function:a.Worker", "class:a.work",
            "line:a.py", "line:a.py#junk", "line:missing.py#1", "line:a.py#10",
            "stmt:a.work", "stmt:a.work#junk", "stmt:a.work#5", "finding:missing",
            "dep:a", "dep:a->missing", "call:a.py", "call:a.py#junk", "call:a.py#1",
            "inherit:a.Worker", "inherit:b.Base->a.Worker", "cycle:bad", "unknown:value",
        ]
        kept, errors = self.index.check(["summary:project", *invalid, "module:a"])
        self.assertEqual(kept, ["summary:project", "module:a"])
        self.assertEqual([item["ref"] for item in errors], invalid)
        self.assertTrue(all(item["error"] for item in errors))

    def test_slices_include_owner_calls_findings_and_module_directions(self):
        self.assertEqual(self.index.status, "complete")
        self.assertEqual(self.index.symbols(), ["a.Worker", "a.Worker.run", "a.work", "b.Base"])
        self.assertEqual([item["id"] for item in self.index.functions_of_file("a.py")], ["a.Worker.run", "a.work"])
        self.assertEqual([item["id"] for item in self.index.classes_of_file("b.py")], ["b.Base"])
        worker = self.index.slice_function("a.Worker.run")
        self.assertEqual(worker["owner_class"]["id"], "a.Worker")
        self.assertEqual(worker["calls"][0]["target"], "a.work")
        self.assertEqual(self.index.callers_of("a.work")[0]["source"], "a.Worker.run")
        self.assertEqual([item["rule_id"] for item in self.index.slice_function("a.work")["findings"]], ["A3-IO"])
        module = self.index.slice_module("a")
        self.assertEqual((module["depends_on"], module["depended_by"]), (["b"], ["b"]))
        self.assertEqual(module["classes"], ["a.Worker"])
        self.assertIsNone(self.index.slice_function("missing"))
        self.assertIsNone(self.index.slice_module("missing"))
        self.assertIsNone(self.index.module_of("missing.py"))

    def test_class_slice_has_no_method_owner(self):
        result = self.index.slice_function("a.Worker")
        self.assertEqual(result["kind"], "class")
        self.assertIsNone(result["owner_class"])

    def test_fingerprints_distinguish_source_changes_and_ignore_input_order(self):
        reordered = index_for(dict(reversed(list(self.files.items()))))
        changed = index_for({**self.files, "b.py": self.files["b.py"] + "# comment\n"})
        self.assertEqual(self.index.fingerprint(), reordered.fingerprint())
        self.assertNotEqual(self.index.fingerprint(), changed.fingerprint())
        self.assertEqual(self.index.fingerprint("a.work"), changed.fingerprint("a.work"))

    def test_function_slice_marks_statement_cap_and_keeps_first_lines(self):
        count = MAX_STATEMENTS_PER_FUNCTION + 1
        index = index_for({"main.py": "def run():\n" + "    pass\n" * count})
        result = index.slice_function("main.run")
        self.assertTrue(result["statements_truncated"])
        self.assertEqual([item["line"] for item in result["statements"]],
                         list(range(2, 2 + MAX_STATEMENTS_PER_FUNCTION)))

    def test_index_handles_partial_records_and_rejects_non_result_objects(self):
        with self.assertRaises(ValueError):
            build_index(None)
        index = build_index({
            "files": [{"path": None}, {"path": "bad#name.py"}],
            "functions": [{"id": None}],
        })
        self.assertEqual(index.symbols(), [])
        self.assertEqual(index.unaddressable, ["bad#name.py"])
