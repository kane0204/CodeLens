"""Regression cases for static SOLID contracts and analysis coverage."""
import ast
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import analyze
from core_engine import rules
from backend.server import enrich, ai_analyze
from core_engine import solid


def evaluate(source, more=None):
    files = {"sample.py": source, **(more or {})}
    return rules.evaluate(analyze({"files": [{"path": p, "content": s} for p, s in files.items()]}))


class SolidTests(unittest.TestCase):
    def test_signature_comparison_returns_unknown_for_missing_receiver(self):
        parent = ast.parse("def f(self, x): pass").body[0]
        child = ast.parse("def f(): pass").body[0]
        self.assertIsNone(solid._narrowed(parent, child))

    def test_signature_above_work_limit_reports_coverage_gap(self):
        args = ", ".join(f"arg{i}" for i in range(129))
        source = f"class Parent:\n    def f(self, {args}): pass\nclass Child(Parent):\n    def f(self, *args): pass\n"
        result = analyze({"files": [{"path": "large.py", "content": source}]})
        report = enrich(result)["solid"]
        self.assertTrue(any("签名超出静态检查范围" in gap["reason"] for gap in report["coverage_gaps"]))

    def test_qualified_exception_refusal_after_docstring_preserves_contract_evidence(self):
        source = '''class Parent:
    def run(self): return True
    def stop(self): return False

class Child(Parent):
    def run(self):
        """No implementation."""
        raise builtins.NotImplementedError()
'''
        result = enrich(analyze({"files": [{"path": "main.py", "content": source}]}))
        findings = {item["rule_id"]: item for item in result["findings"]}
        self.assertEqual(findings["LSP-01"]["line"], 6)
        self.assertEqual(findings["ISP-01"]["line"], 6)

    def test_invalid_binding_signature_or_decorator_reports_gap(self):
        for method in ("    def f(): pass", "    def f(self, a, a): pass",
                       "    @custom()\n    def f(self, a): pass"):
            source = "class Parent:\n    def f(self, a): pass\nclass Child(Parent):\n" + method
            result = enrich(analyze({"files": [{"path": "main.py", "content": source}]}))
            with self.subTest(method=method):
                self.assertTrue(any("绑定签名无法静态检查" in gap["reason"]
                                    for gap in result["solid"]["coverage_gaps"]))

    def check_override(self, parent, child, expected=True):
        out = evaluate("class Base:\n    " + parent + "\nclass Child(Base):\n    " + child + "\n")
        self.assertEqual(any(f["rule_id"] == "LSP-01" for f in out["findings"]), expected, out)
        return out

    def test_required_parameter_added(self):
        self.check_override("def f(self, x): return x", "def f(self, x, y): return x")

    def test_keyword_renamed(self):
        self.check_override("def f(self, x): return x", "def f(self, y): return y")

    def test_optional_becomes_required(self):
        self.check_override("def f(self, x=1): return x", "def f(self, x): return x")

    def test_keyword_only_added(self):
        self.check_override("def f(self): return 1", "def f(self, *, x): return x")

    def test_positional_only_is_more_restrictive(self):
        self.check_override("def f(self, x): return x", "def f(self, x, /): return x")

    def test_variadic_removed(self):
        self.check_override("def f(self, *args, **kwargs): return 1", "def f(self, x=0): return x")

    def test_safe_widening(self):
        self.check_override("def f(self, x, /, *, y=1): return x", "def f(self, x, y=1, *args, **kwargs): return x", False)

    def test_constructor_excluded(self):
        self.check_override("def __init__(self): pass", "def __init__(self, value): pass", False)

    def test_async_contract(self):
        self.check_override("async def f(self): return 1", "def f(self): return 1")

    def test_static_contract(self):
        self.check_override("@staticmethod\n    def f(x): return x", "def f(self, x): return x")

    def test_refused_contract_has_isp_and_lsp_evidence(self):
        out = evaluate('''class Base:
    def read(self): return 1
    def write(self, value): return value
class ReadOnly(Base):
    def write(self, value): raise NotImplementedError("read only")
''')
        hits = [f for f in out["findings"] if f["rule_id"] in {"LSP-01", "ISP-01"}]
        self.assertEqual({f["rule_id"] for f in hits}, {"LSP-01", "ISP-01"})
        for hit in hits:
            self.assertEqual(hit["line"], 5)
            self.assertEqual(hit["related"][0]["line"], 3)
            self.assertEqual(hit["evidence_type"], "inference")

    def test_abstract_parent_is_not_implemented_behavior(self):
        out = evaluate('''from abc import ABC, abstractmethod
class Base(ABC):
    @abstractmethod
    def f(self): raise NotImplementedError
class Child(Base):
    def f(self): return 1
''')
        self.assertFalse(any(f["rule_id"] in {"ISP-01", "LSP-01"} for f in out["findings"]))

    def test_abstract_interface_refusal_is_isp(self):
        out = evaluate("from abc import ABC, abstractmethod\nclass Base(ABC):\n    @abstractmethod\n    def read(self): pass\n    @abstractmethod\n    def write(self): pass\nclass Child(Base):\n    def read(self): return 1\n    def write(self): raise NotImplementedError\n")
        self.assertTrue(any(f["rule_id"] == "ISP-01" for f in out["findings"]))
        self.assertEqual(out["solid"]["coverage_gaps"], [])

    def test_cross_file_and_transitive_inheritance(self):
        out = evaluate('''from base import Base as Parent
class Mid(Parent): pass
class Child(Mid):
    def f(self, x): return x
''', {"base.py": "class Base:\n    def f(self, x=0): return x\n"})
        self.assertTrue(any(f["rule_id"] == "LSP-01" for f in out["findings"]))

    def test_unknown_and_multiple_bases_report_coverage_gap(self):
        out = evaluate("class A: pass\nclass B: pass\nclass C(A, B): pass\nclass D(External): pass\n")
        self.assertEqual(len(out["solid"]["coverage_gaps"]), 2)

    def test_custom_decorator_is_not_guessed(self):
        out = self.check_override("def f(self): return 1", "@custom\n    def f(self, x): return x", False)
        self.assertEqual(len(out["solid"]["coverage_gaps"]), 1)

    def test_dip_uses_resolved_aliases(self):
        out = evaluate('''from deps import A as X, B as Y
class Consumer:
    def build(self): return X(), Y()
''', {"deps.py": "class A: pass\nclass B: pass\n"})
        self.assertTrue(any(f["rule_id"] == "DIP-01" for f in out["findings"]))

    def test_srp_does_not_count_private_methods(self):
        out = evaluate("class Internal:\n" + "".join("    def _m%d(self): pass\n" % i for i in range(14)))
        self.assertFalse(any(f["rule_id"] == "SRP-01" for f in out["findings"]))

    def test_enriched_and_ai_paths_include_all_five(self):
        payload = {"files": [{"path": "sample.py", "content": "class A:\n    def f(self): return 1\nclass B(A):\n    def f(self, x): return x\n"}]}
        result = enrich(analyze(payload))
        self.assertTrue(set(result["solid"]["rules"]).issubset(result["config"]["rules"]))
        self.assertEqual(result["summary"]["findings"], len(result["findings"]))
        out = ai_analyze({**payload, "skills": ["solid-review"], "targets": ["class:sample.B"]})
        self.assertEqual(len(out["results"][0]["outputs"]["checks"]), 5)
        self.assertEqual(out["results"][0]["citations"]["coverage"], 1.0)

    def test_results_are_deterministic(self):
        source = "class A:\n    def f(self): return 1\nclass B(A):\n    def f(self, x): return x\n"
        self.assertEqual(evaluate(source), evaluate(source))


if __name__ == "__main__":
    unittest.main()
