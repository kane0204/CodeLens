"""Project history, issue tracking, and review context regression tests."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))

from ai import explanation
from backend.history import HistoryStore, MEMORY_BYTES, memory_prompt
from backend.server import analyze, enrich


def report(content, *, path="main.py", issue=True, name="same"):
    result = enrich(analyze({"project": name, "files": [{"path": path, "content": content}]}))
    result["findings"] = ([{"id": "F1", "rule_id": "CC-01", "file": path,
                           "severity": "medium", "line": result["functions"][0]["line"],
                           "message": "复杂度超限"}] if issue else [])
    return result


class HistoryTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.store = HistoryStore(Path(directory) / "history.sqlite3")

    def record(self, body, project=None, **kwargs):
        return self.store.record(report(body, **kwargs), project)

    def test_scans_are_isolated_and_identical_versions_are_reused(self):
        source = "def run():\n    return 1"
        one = self.record(source)
        project = one["project_id"]
        other = self.record(source)
        repeat = self.record(source, project, name="renamed")
        self.assertNotEqual(project, other["project_id"])
        runs = self.store.runs(project)
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[0]["version"], runs[1]["version"])
        detail = self.store.detail(project, repeat["analysis_id"])
        self.assertNotIn("source", detail["report"]["files"][0])
        self.assertEqual(detail["changes"]["modified"], [])
        self.assertEqual(self.store.memory(other["project_id"], other["analysis_id"], ["main.py"], True), [])
        with self.assertRaisesRegex(ValueError, "分析记录不存在"):
            self.store.detail(other["project_id"], repeat["analysis_id"])
        with self.assertRaisesRegex(ValueError, "项目历史不存在"):
            self.record(source, "missing")
        self.assertEqual(len(self.store.projects()), 2)

    def test_streak_requires_three_distinct_versions_and_line_can_move(self):
        first = self.record("def run():\n    return 1")
        project = first["project_id"]
        self.record("\ndef run():\n    return 2", project)
        again = self.record("def run():\n    return 1", project)
        self.assertEqual(again["recurring"], [])
        third = self.record("\n\ndef run():\n    return 3", project)
        row, = third["recurring"]
        self.assertEqual((row["first"], row["streak"], row["line"]), (first["analysis_id"], 3, 3))
        memory = self.store.memory(project, third["analysis_id"], ["main.py"], True)
        self.assertEqual(memory[0]["analysis_id"], again["analysis_id"])
        self.assertEqual(self.store.memory(project, third["analysis_id"], ["other.py"], True), [])
        self.assertEqual(self.store.memory(project, third["analysis_id"], ["main.py"], False), [])

    def test_recurrence_and_unknown_coverage(self):
        first = self.record("def run():\n    return 1")
        project = first["project_id"]
        fixed = self.record("def run():\n    return 2", project, issue=False)
        self.assertEqual(self.store.detail(project, fixed["analysis_id"])["issues"][0]["state"], "resolved")
        recurred = self.record("def run():\n    return 3", project)
        self.assertTrue(recurred["recurring"][0]["recurred"])
        self.assertEqual(self.store.memory(project, recurred["analysis_id"], ["main.py"], True)[0]["state"], "resolved")
        missing = self.record("def other():\n    pass", project, path="other.py", issue=False)
        detail = self.store.detail(project, missing["analysis_id"])
        self.assertEqual(detail["changes"]["missing"], ["main.py"])
        self.assertEqual(detail["issues"][0]["state"], "unverified")
        changed = report("def run():\n    return 1", issue=False)
        changed["engine_version"] = "new-rules"
        current = self.store.record(changed, project)
        self.assertTrue(self.store.detail(project, current["analysis_id"])["changes"]["rules_changed"])
        self.assertEqual(self.store.memory(project, current["analysis_id"], ["main.py"], True), [])

    def test_delete_cascades_and_completed_review_survives_reopen(self):
        analysis = self.record("def run():\n    return 1")
        project, run = analysis["project_id"], analysis["analysis_id"]
        self.store.save_review(project, run, "running")
        self.store.save_review(project, run, "done", {"sections": {}})
        self.store.save_review(project, run, "paused")
        checkpoint = self.store.checkpoints(project)
        self.assertIsNone(checkpoint.load("key"))
        checkpoint.save("key", {"notes": ["note"]}, 1)
        reopened = HistoryStore(self.store.path)
        self.assertEqual(reopened.detail(project, run)["ai"], {"sections": {}})
        self.assertEqual(reopened.checkpoints(project).load("key"), {"notes": ["note"]})
        reopened.delete(project)
        checkpoint.save("key", {"notes": ["late update"]}, 2)
        self.assertEqual(reopened.runs(project), [])
        self.assertIsNone(checkpoint.load("key"))

    def test_context_budget_and_review_cache_key(self):
        items = [{"analysis_id": i, "message": "问题" * 50} for i in range(100)]
        prompt, references = memory_prompt(items, "current source")
        self.assertGreater(len(references), 0)
        self.assertLessEqual(len(references), 5)
        self.assertLessEqual(len(prompt.encode()), MEMORY_BYTES)
        self.assertEqual(memory_prompt(items, "x" * 24000), ("", []))
        first = self.record("def run():\n    return 1")
        project = first["project_id"]
        payload = {"project": "same", "scope": "file", "files": [{"path": "main.py", "content": "x = 1"}],
                   "provider": {"base_url": "https://model.invalid", "model": "mock"}}
        with patch.object(explanation, "_chat", return_value=('{"logic":"用途 [main.py:L1]"}', False)) as chat:
            result = explanation.review(payload, memory=items[:1], history_project=project)
            self.assertIn("历史问题线索", chat.call_args.args[-1])
            self.assertEqual(result["history_references"], [0])
            self.assertEqual(explanation.cached_review(payload, None, memory=items[:1], history_project=project), result)
            self.assertIsNone(explanation.cached_review(payload, None, memory=items[:1], history_project="other"))

    def test_file_level_finding_without_source_line(self):
        result = report("def run():\n    return 1")
        result["findings"][0]["line"] = None
        run = self.store.record(result, None)
        detail = self.store.detail(run["project_id"], run["analysis_id"])
        self.assertEqual(detail["issues"][0]["symbol"], "")
