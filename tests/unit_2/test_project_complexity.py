"""Guard the complexity limits used to audit the project's own source code."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "code"))
from core_engine.engine import analyze

LIMITS = {"cc": 8, "length": 50, "nesting": 4}
WEB_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx"}


class ProjectComplexityTests(unittest.TestCase):
    def test_application_and_ddd_example_meet_report_limits(self):
        paths = list((ROOT / "code").rglob("*.py"))
        paths.extend(path for path in (ROOT / "codelens-prototype/src").rglob("*")
                     if path.is_file() and path.suffix in WEB_EXTENSIONS)
        paths.append(ROOT / "docs/software/ddd/domain_model.py")
        files = [{"path": path.relative_to(ROOT).as_posix(), "content": path.read_text(encoding="utf-8-sig")}
                 for path in sorted(paths)]
        result = analyze({"project": "CodeLens", "files": files})

        self.assertEqual(result["summary"]["parsed"], len(files), result["errors"])
        self.assertTrue(result["functions"])
        violations = []
        for function in result["functions"]:
            for metric, limit in LIMITS.items():
                if function[metric] > limit:
                    location = f"{function['file']}:{function['line']}"
                    violations.append(f"{location} {function['id']} {metric}={function[metric]} > {limit}")
        self.assertFalse(violations, "\n".join(violations))
