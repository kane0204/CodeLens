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

    def test_scoped_review_uses_natural_guidance_and_only_requests_logic(self):
        for scope, guide in (("file", "包初始化"), ("folder", "如何分工")):
            with self.subTest(scope=scope):
                self.chat.return_value = (json.dumps({"logic": "用途 [main.py:L1-L2]"}), False)
                result = explanation.review({**self.payload, "scope": scope})
                self.assertEqual(result["scope"], scope)
                self.assertEqual(list(result["sections"]), ["logic"])
                self.assertTrue(result["sections"]["logic"]["citations"][0]["valid"])
                prompt = self.chat.call_args.args[-1]
                self.assertIn(guide, prompt)
                self.assertIn("通俗", prompt)
                self.assertNotIn('"design"', prompt)
        self.assertEqual(self.chat.call_count, 2)
        with self.assertRaisesRegex(ValueError, "审查范围"):
            explanation.review({**self.payload, "scope": "invalid"})

    def test_pausing_after_read_preserves_notes_and_their_truncation(self):
        self.chat.side_effect = [("first note", True), ("next note", False), (self.report, False)]

        def disconnect(event):
            if event["stage"] == "read" and event["done"] == 1:
                raise BrokenPipeError()

        payload = {**self.payload, "files": [
            {"path": "a.py", "content": "# " + "x" * 600},
            {"path": "b.py", "content": "# " + "x" * 600},
        ]}
        with patch.object(explanation, "MAX_PROJECT_BATCH_CHARS", 1000):
            with self.assertRaises(BrokenPipeError):
                explanation.review(payload, progress=disconnect)
            self.assertEqual(self.chat.call_count, 1)
            result = explanation.review(payload)
        self.assertEqual(self.chat.call_count, 3)
        self.assertTrue(result["truncated"])
        self.assertIn("first note", self.chat.call_args.args[-1])

    def test_synthesis_limit_retains_material_from_every_batch(self):
        notes = ["first " + "x" * 200, "second " + "y" * 200]
        with patch.object(explanation, "MAX_REVIEW_SYNTHESIS_CHARS", 100):
            material, facts, limited = explanation._bounded_synthesis(notes, "z" * 80)
        self.assertTrue(limited)
        self.assertLessEqual(len(material) + len(facts), 100)
        self.assertIn("first", material)
        self.assertIn("second", material)

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

    def test_waiter_observes_original_failure_after_retry_claims_job(self):
        original, _ = explanation._claim_review_job("same-input")
        waiting, state = explanation._claim_review_job("same-input")
        self.assertEqual(state, "waiting")
        original.notes.append("completed batch")
        explanation._finish_review(original, "failed", error="first attempt failed")
        retry, state = explanation._claim_review_job("same-input")
        self.assertEqual(state, "owner")
        self.assertIsNot(retry, waiting)
        self.assertEqual(retry.notes, ["completed batch"])
        self.assertTrue(waiting.finished.is_set())
        with self.assertRaisesRegex(explanation.ExplanationError, "first attempt failed"):
            explanation._await_review(waiting, None)

    def test_segment_end_matches_the_last_rendered_line(self):
        record = {"path": "main.py", "source": "first\n" + "x" * 210 + "\nlast"}
        with patch.object(explanation, "MAX_PROJECT_BATCH_CHARS", 720):
            segments = list(explanation._file_segments(record))
        for _, start, end, rendered in segments:
            numbers = [int(line.split(":", 1)[0]) for line in rendered.splitlines()]
            self.assertEqual((start, end), (numbers[0], numbers[-1]))

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

    def test_completed_jobs_are_evicted_before_failed_checkpoints(self):
        with patch.object(explanation, "_REVIEW_JOB_LIMIT", 2):
            failed, _ = explanation._claim_review_job("failed")
            failed.notes.append("completed batch")
            explanation._finish_review(failed, "failed", error="timeout")
            done, _ = explanation._claim_review_job("done")
            explanation._finish_review(done, "done", result={})
            explanation._claim_review_job("new")
            self.assertNotIn("done", explanation._REVIEW_JOBS)
            retried, _ = explanation._claim_review_job("failed")
            self.assertEqual(retried.notes, ["completed batch"])

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
