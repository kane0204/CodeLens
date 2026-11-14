"""Check that special-risk coverage matches the analysis language."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.engine import analyze
from core_engine.special import build


class SpecialRiskTests(unittest.TestCase):
    def test_python_project_does_not_show_non_python_limitations(self):
        result = analyze({"files": [{"path": "a.py", "content": "open('input.txt')\n"}]})
        categories = {item["id"]: item for item in build(result)["categories"]}
        exception = categories["unhandled-exception"]
        self.assertEqual(exception["items"][0]["line"], 1)
        self.assertIsNone(exception["reason"])
        self.assertIsNone(categories["dead-code"]["reason"])

    def test_non_python_project_shows_detection_limits(self):
        result = analyze({"files": [{"path": "app.js", "content": "function run() { work(); }"}]})
        categories = {item["id"]: item for item in build(result)["categories"]}
        self.assertIn("Python", categories["unhandled-exception"]["reason"])
        self.assertIn("非 Python", categories["dead-code"]["reason"])

    def test_missing_input_and_duplicate_group_without_occurrences(self):
        self.assertEqual(build(None), {"categories": []})
        categories = build({"duplicates": [{}, {"occurrences": [{"file": "a.py", "line": 3}]}]})
        duplicate = next(item for item in categories["categories"] if item["id"] == "duplicate-implementation")
        self.assertEqual([(row["file"], row["line"]) for row in duplicate["items"]], [("a.py", 3)])
