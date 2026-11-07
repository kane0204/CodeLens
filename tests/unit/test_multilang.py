import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))

from backend.server import enrich
from core_engine.engine import analyze


class MultiLanguageTests(unittest.TestCase):
    def analyze(self, files):
        return enrich(analyze({
            "project": "multi-language",
            "files": [{"path": path, "content": source} for path, source in files.items()],
        }))

    def test_java_and_cpp_are_parsed_and_risk_is_redacted(self):
        result = self.analyze({
            "src/Main.java": """
import java.io.File;
class Main {
  static String token = "REAL_SECRET_12345";
  public static void run(String[] args) {
    if (args.length > 0) { Runtime.getRuntime().exec(args[0]); }
    // TODO replace this temporary path
  }
}
""",
            "src/Util.cpp": """
#include <fstream>
int add(int value) {
  if (value > 0) { return value + 1; }
  return 0;
}
""",
        })
        self.assertEqual(result["summary"]["files"], 2)
        self.assertIn("Java", result["config"]["language"])
        self.assertIn("C++", result["config"]["language"])
        self.assertGreaterEqual(result["summary"]["functions"], 2)
        self.assertTrue(any(item["rule_id"] == "A4" for item in result["findings"]))
        self.assertNotIn("REAL_SECRET_12345", str(result["findings"]))
        categories = {item["id"]: item for item in result["special_risks"]["categories"]}
        self.assertGreater(categories["hardcoded-secret"]["count"], 0)
        self.assertGreater(categories["suspicious-dependency"]["count"], 0)
        self.assertGreater(categories["comment-mismatch"]["count"], 0)

    def test_mixed_python_and_generic_files_merge(self):
        result = self.analyze({
            "app.py": "def run(value):\n    return value + 1\n",
            "Worker.cs": "class Worker { void Run() { } }\n",
        })
        self.assertEqual(result["summary"]["files"], 2)
        self.assertEqual(result["summary"]["parsed"], 2)
        self.assertEqual({item["path"] for item in result["files"]}, {"app.py", "Worker.cs"})
        self.assertIn("Python", result["config"]["language"])
        self.assertIn("C#", result["config"]["language"])

    def test_unsupported_files_are_excluded_without_failure(self):
        result = self.analyze({
            "README.md": "# docs",
            "Main.java": "class Main { public static void main(String[] args) { } }\n",
        })
        self.assertEqual(result["summary"]["files"], 1)
        self.assertEqual(result["summary"]["excluded"], 1)
        self.assertEqual(result["status"], "complete")


if __name__ == "__main__":
    unittest.main()
