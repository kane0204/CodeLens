"""健康度评分与时序序列的单元测试。

两个模块都只吃引擎已产出的结果，因此测试用真实 analyze() 的输出，
而不是手搓字典——手搓一旦和引擎字段漂移，测试就会假通过。
"""
import base64
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))

from core_engine import health, sequence  # noqa: E402
from core_engine.engine import analyze  # noqa: E402

DEEP = '''def helper(value):
    return value + 1


def hot(numbers):
    total = 0
    for number in numbers:
        if number > 0:
            if number % 2:
                for step in range(number):
                    if step:
                        total += step
    return total


def main():
    return helper(hot([1, 2, 3]))
'''

SIMPLE = '''def tiny(value):
    return value
'''


def payload(files):
    return {
        "project": "demo",
        "files": [
            {"path": path, "content_base64": base64.b64encode(source.encode("utf-8")).decode("ascii")}
            for path, source in files
        ],
    }


def run(files):
    return analyze(payload(files))


class HealthTests(unittest.TestCase):
    def test_result_untouched(self):
        result = run([("demo.py", SIMPLE)])
        before = json.dumps(result, sort_keys=True, ensure_ascii=False)
        health.apply(result)
        self.assertEqual(json.dumps(result, sort_keys=True, ensure_ascii=False), before)
        self.assertNotIn("health", result)

    def test_deterministic(self):
        result = run([("demo.py", DEEP)])
        first = json.dumps(health.apply(result), sort_keys=True, ensure_ascii=False)
        second = json.dumps(health.apply(result), sort_keys=True, ensure_ascii=False)
        self.assertEqual(first, second)

    def test_clean_function_scores_full(self):
        result = health.apply(run([("demo.py", SIMPLE)]))
        function = result["functions"][0]
        self.assertEqual(function["score"], 100)
        self.assertEqual(function["score_grade"], "优秀")
        for item in function["score_deductions"]:
            self.assertEqual(item["penalty"], 0)

    def test_penalties_are_explainable(self):
        # cc 19 / length 33 / nesting 6，阈值 10 / 50 / 4：
        # 圈复杂度超 9 → 2×9=18；长度未超；嵌套超 2 → 4×2=8；合计 26，得分 74。
        detail = health.function_score({"cc": 19, "length": 33, "nesting": 6})
        self.assertEqual(detail["score"], 74)
        self.assertEqual(detail["grade"], "一般")
        penalties = {item["dimension"]: item["penalty"] for item in detail["deductions"]}
        self.assertEqual(penalties, {"cc": 18, "length": 0, "nesting": 8})

    def test_length_penalty_rounds_up(self):
        # 长度 75 → 超 25 → 向上取整 3 个单位 → 9 分。
        detail = health.function_score({"cc": 1, "length": 75, "nesting": 1})
        self.assertEqual(detail["score"], 91)
        length = [item for item in detail["deductions"] if item["dimension"] == "length"][0]
        self.assertEqual((length["over"], length["penalty"]), (25, 9))

    def test_caps_hold(self):
        detail = health.function_score({"cc": 100, "length": 1000, "nesting": 40})
        self.assertEqual(detail["score"], 30)
        self.assertEqual(detail["grade"], "需关注")
        penalties = {item["dimension"]: item["penalty"] for item in detail["deductions"]}
        self.assertEqual(penalties, {"cc": 30, "length": 20, "nesting": 20})

    def test_missing_metric_is_not_penalised(self):
        detail = health.function_score({"cc": 5, "nesting": 1})
        self.assertEqual(detail["score"], 100)
        self.assertEqual(detail["deductions"][1]["measured"], None)

    def test_project_score_is_average(self):
        result = health.apply(run([("demo.py", DEEP)]))
        scores = [item["score"] for item in result["functions"]]
        self.assertEqual(result["health"]["score"], round(sum(scores) / len(scores)))
        self.assertEqual(result["health"]["function_count"], len(scores))
        self.assertTrue(result["health"]["available"])
        self.assertIn("formula", result["health"])
        self.assertLessEqual(result["health"]["score"], 100)

    def test_thresholds_come_from_config(self):
        result = run([("demo.py", DEEP)])
        baseline = health.apply(result)
        result["config"]["thresholds"] = {"cc": 1, "length": 5, "nesting": 1}
        scored = health.apply(result)
        self.assertEqual(scored["health"]["thresholds"]["cc"], 1)
        pick = lambda r: [f for f in r["functions"] if f["id"].endswith("hot")][0]  # noqa: E731
        self.assertLess(pick(scored)["score"], pick(baseline)["score"])
        self.assertLess(pick(scored)["score"], 100)

    def test_empty_result_degrades(self):
        scored = health.apply({"status": "empty", "functions": []})
        self.assertTrue(scored["health"]["available"])
        self.assertIsNone(scored["health"]["score"])
        broken = health.apply({"status": "ok"})
        self.assertFalse(broken["health"]["available"])


class SequenceTests(unittest.TestCase):
    def test_orders_by_line_and_marks_status(self):
        result = run([("demo.py", DEEP)])
        model = sequence.build(result)
        self.assertTrue(model["available"])
        self.assertEqual(len(model["files"]), 1)
        entry = model["files"][0]
        self.assertEqual(entry["file"], "demo.py")
        lines = [step["line"] for step in entry["steps"]]
        self.assertEqual(lines, sorted(lines))
        self.assertTrue(entry["steps"])
        for step in entry["steps"]:
            self.assertIn(step["status"], ("resolved", "unresolved"))
            self.assertIn("participant", step)
        self.assertGreaterEqual(model["resolved"] + model["unresolved"], 1)

    def test_enclosing_function_is_innermost(self):
        result = run([("demo.py", DEEP)])
        model = sequence.build(result)
        steps = model["files"][0]["steps"]
        hits = [step for step in steps if "helper" in str(step.get("target"))]
        if hits:
            self.assertEqual(hits[0]["enclosing"], "demo.main")

    def test_truncation(self):
        source = "def source():\n    return 1\n\n\ndef sink():\n" + "".join(
            "    source()\n" for _ in range(50)
        )
        result = run([("demo.py", source)])
        model = sequence.build(result, max_steps=5)
        entry = model["files"][0]
        self.assertEqual(len(entry["steps"]), 5)
        self.assertTrue(entry["truncated"])
        self.assertGreater(entry["total"], 5)

    def test_no_calls_degrades(self):
        model = sequence.build({"status": "ok", "graph": {"calls": []}, "files": []})
        self.assertFalse(model["available"])
        self.assertEqual(model["files"], [])
        self.assertIn("reason", model)

    def test_notes_state_static_order(self):
        model = sequence.build(run([("demo.py", DEEP)]))
        self.assertTrue(any("不代表运行时执行顺序" in note for note in model["notes"]))


if __name__ == "__main__":
    unittest.main()
