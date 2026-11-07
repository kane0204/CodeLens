"""Exercise project review with the model transport mocked."""
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from ai import explanation


class ProjectReviewTests(unittest.TestCase):
    def setUp(self):
        jobs = patch.object(explanation, "_REVIEW_JOBS", {})
        jobs.start()
        self.addCleanup(jobs.stop)
        chat = patch.object(explanation, "_chat")
        self.chat = chat.start()
        self.addCleanup(chat.stop)
        self.payload = {
            "project": "example",
            "provider": {"base_url": "https://model.invalid/v1", "model": "model-a"},
            "files": [{"path": "main.py", "content": "def main():\n    return 1\n"}],
        }
        self.report = json.dumps({
            "logic": "Entry point [main.py:L1-L2]",
            "design": "Unknown file [missing.py:L1]",
            "risks": "Out of range [main.py:L3]",
        })

    def test_review_checks_citations_and_reports_model_truncation(self):
        self.chat.return_value = (self.report, True)

        result = explanation.review(self.payload)

        self.assertEqual(result["scope"], "project")
        self.assertEqual((result["source_files"], result["batch_count"]), (1, 1))
        self.assertTrue(result["truncated"])
        sections = result["sections"]
        self.assertEqual(set(sections), {"logic", "design", "risks"})
        logic, = sections["logic"]["citations"]
        self.assertEqual((logic["file"], logic["line"], logic["end_line"]), ("main.py", 1, 2))
        self.assertTrue(logic["valid"])
        design, = sections["design"]["citations"]
        risks, = sections["risks"]["citations"]
        self.assertFalse(design["valid"])
        self.assertFalse(risks["valid"])

    def test_completed_review_is_reused_only_for_matching_source_and_model(self):
        self.chat.return_value = (self.report, False)
        first = explanation.review(self.payload)

        self.assertEqual(explanation.review(self.payload), first)
        self.chat.assert_called_once()

        changed = {**self.payload, "files": [
            {"path": "main.py", "content": "def main():\n    return 2\n"},
        ]}
        explanation.review(changed)
        changed_model = {**changed, "provider": {**changed["provider"], "model": "model-b"}}
        result = explanation.review(changed_model)

        self.assertEqual(result["model"], "model-b")
        self.assertEqual(self.chat.call_count, 3)
        self.assertIn("return 2", self.chat.call_args_list[1].args[-1])

    def test_failed_batch_resumes_after_last_completed_batch(self):
        self.payload["files"] = [
            {"path": "main.py", "content": "# " + "a" * 500 + "\n"},
            {"path": "worker.py", "content": "# " + "b" * 500 + "\n"},
        ]
        self.chat.side_effect = [
            ("main notes", False),
            explanation.ExplanationError("model timeout"),
            ("worker notes", False),
            (self.report, False),
        ]
        progress = []
        with patch.object(explanation, "MAX_PROJECT_BATCH_CHARS", 1000):
            with self.assertRaisesRegex(explanation.ExplanationError, "model timeout"):
                explanation.review(self.payload)
            result = explanation.review(self.payload, progress=progress.append)

        self.assertEqual(result["batch_count"], 2)
        self.assertEqual(self.chat.call_count, 4)
        first, failed, retried, final = [call.args[-1] for call in self.chat.call_args_list]
        self.assertIn("main.py", first)
        self.assertIn("worker.py", failed)
        self.assertEqual(failed, retried)
        self.assertIn("main notes", final)
        self.assertIn("worker notes", final)
        self.assertEqual((progress[0]["stage"], progress[0]["done"], progress[0]["total"]),
                         ("read", 1, 3))
        self.assertEqual((progress[-1]["stage"], progress[-1]["done"]), ("review", 3))

    def test_incomplete_model_report_is_rejected_and_can_be_retried(self):
        self.chat.side_effect = [
            (json.dumps({"logic": "Only one section"}), False),
            (self.report, False),
        ]

        with self.assertRaises(explanation.ExplanationError):
            explanation.review(self.payload)
        result = explanation.review(self.payload)

        self.assertEqual(set(result["sections"]), {"logic", "design", "risks"})
        self.assertEqual(self.chat.call_count, 2)

    def test_concurrent_review_waits_for_in_flight_request_and_reuses_result(self):
        model_started = Event()
        waiter_attached = Event()
        release_model = Event()

        def model_call(*args):
            model_started.set()
            if not release_model.wait(5):
                raise TimeoutError("test did not release model call")
            return self.report, False

        def record_progress(event):
            if event["stage"] == "resume":
                waiter_attached.set()

        self.chat.side_effect = model_call
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(explanation.review, self.payload)
            try:
                self.assertTrue(model_started.wait(5), "model request did not start")
                second = pool.submit(explanation.review, self.payload, progress=record_progress)
                self.assertTrue(waiter_attached.wait(5), "second review did not attach")
                self.assertFalse(second.done())
            finally:
                release_model.set()
            self.assertEqual(first.result(timeout=5), second.result(timeout=5))

        self.chat.assert_called_once()

    def test_waiting_review_receives_the_original_model_failure(self):
        model_started = Event()
        attached = Event()
        release = Event()

        def fail(*_):
            model_started.set()
            if not release.wait(5):
                raise TimeoutError("test did not release model call")
            raise explanation.ExplanationError("model timeout")

        def progress(event):
            if event["stage"] == "resume":
                attached.set()

        self.chat.side_effect = fail
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(explanation.review, self.payload)
            try:
                self.assertTrue(model_started.wait(5))
                waiting = pool.submit(explanation.review, self.payload, progress=progress)
                self.assertTrue(attached.wait(5))
            finally:
                release.set()
            for job in (first, waiting):
                with self.assertRaisesRegex(explanation.ExplanationError, "model timeout"):
                    job.result(timeout=5)
        self.chat.assert_called_once()

    def test_no_parseable_source_rejects_review_before_model_call(self):
        self.payload["files"] = [{"path": "main.py", "content": "def ("}]

        with self.assertRaises(ValueError):
            explanation.review(self.payload)

        self.chat.assert_not_called()

    def test_review_accepts_fenced_json_and_rejects_other_model_shapes(self):
        self.chat.side_effect = [
            ("nothing structured", False), ("prefix {broken}", False), ("[]", False),
            ("```json\n" + self.report + "\n```", False),
        ]
        for _ in range(3):
            with self.assertRaisesRegex(explanation.ExplanationError, "结构化审查结果"):
                explanation.review(self.payload)
        result = explanation.review(self.payload)
        self.assertIn("Entry point", result["sections"]["logic"]["markdown"])

    def test_review_cache_evicts_old_completed_results(self):
        self.chat.return_value = (self.report, False)
        first, second, third = [
            {**self.payload, "project": project} for project in ("one", "two", "three")
        ]
        with patch.object(explanation, "_REVIEW_JOB_LIMIT", 2):
            for payload in (first, second, third, second):
                explanation.review(payload)
            self.assertEqual(self.chat.call_count, 3)
            explanation.review(first)
        self.assertEqual(self.chat.call_count, 4)
