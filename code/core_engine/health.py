"""确定性健康度评分。

设计约束：
- 只使用引擎已经产出的事实字段（cc / length / nesting），不引入新解析。
- 同样的输入必须得到同样的分数，不引入随机、时间、外部状态。
- 每一分都能解释：所有扣分项显式记录维度、超出的量、扣掉的分数。

口径（与 docs/software/local-workbench.md 的规则表一致）：
- 函数得分基线 100 分，只在超出阈值时扣分，不因为代码长就给奖励。
- 圈复杂度：每超 1 点扣 2 分，该维度最多扣 30 分。
- 函数长度：每超 10 行（向上取整）扣 3 分，该维度最多扣 20 分。
- 最大嵌套：每超 1 层扣 4 分，该维度最多扣 20 分。
- 三项合计最多扣 70 分，因此函数得分区间是 30 到 100。
- 得分不是缺陷判定，只是排序与体检用的单一标量；风险条目仍以 findings 为准。
"""

from copy import deepcopy

DEFAULT_THRESHOLDS = {"cc": 10, "length": 50, "nesting": 4}
RATES = {"cc": 2, "length": 3, "nesting": 4}
CAPS = {"cc": 30, "length": 20, "nesting": 20}
BASE_SCORE = 100
GRADES = ((90, "优秀"), (75, "良好"), (60, "一般"), (0, "需关注"))

FORMULA = "100 - min(30, 2×超出圈复杂度) - min(20, 3×向上取整(超出长度/10)) - min(20, 4×超出嵌套)"
NOTES = (
    "得分只由圈复杂度、函数长度、最大嵌套三项超出阈值的部分决定，分数越高表示越接近阈值内。",
    "得分不是缺陷结论：是否构成风险以风险清单里的规则命中为准。",
    "阈值取自引擎配置 config.thresholds，可在分析配置中调整。",
)


def _int_or_none(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def thresholds_of(result):
    """从引擎结果里取阈值，缺失或非法时回落到默认值。"""
    config = result.get("config") if isinstance(result, dict) else None
    source = config.get("thresholds") if isinstance(config, dict) else None
    limits = {}
    for key, fallback in DEFAULT_THRESHOLDS.items():
        value = _int_or_none(source.get(key)) if isinstance(source, dict) else None
        limits[key] = value if value and value > 0 else fallback
    return limits


def grade_of(score):
    if score is None:
        return None
    for floor, label in GRADES:
        if score >= floor:
            return label
    return GRADES[-1][1]


def function_score(function, thresholds=None):
    """单个函数的得分与扣分明细。"""
    limits = thresholds or DEFAULT_THRESHOLDS
    score = BASE_SCORE
    deductions = []
    for dimension in ("cc", "length", "nesting"):
        measured = _int_or_none(function.get(dimension))
        if measured is None:
            deductions.append({"dimension": dimension, "over": 0, "penalty": 0, "measured": None})
            continue
        over = measured - limits[dimension]
        if over <= 0:
            deductions.append({"dimension": dimension, "over": 0, "penalty": 0, "measured": measured})
            continue
        units = -(-over // 10) if dimension == "length" else over
        penalty = min(CAPS[dimension], RATES[dimension] * units)
        score -= penalty
        deductions.append({"dimension": dimension, "over": over, "penalty": penalty, "measured": measured})
    return {"score": int(score), "grade": grade_of(int(score)), "deductions": deductions}


def apply(result):
    """返回加了函数得分与项目体检结论的结果副本，不改动入参。"""
    if not isinstance(result, dict):
        return result
    copied = deepcopy(result)
    limits = thresholds_of(copied)
    functions = copied.get("functions")
    if not isinstance(functions, list):
        copied["health"] = {
            "available": False,
            "reason": "结果里没有函数指标，无法计算得分",
            "formula": FORMULA,
            "notes": list(NOTES),
        }
        return copied
    distribution = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
    numbers = []
    for function in functions:
        if not isinstance(function, dict):
            continue
        detail = function_score(function, limits)
        function["score"] = detail["score"]
        function["score_grade"] = detail["grade"]
        function["score_deductions"] = detail["deductions"]
        numbers.append(detail["score"])
        if detail["score"] >= 90:
            distribution["excellent"] += 1
        elif detail["score"] >= 75:
            distribution["good"] += 1
        elif detail["score"] >= 60:
            distribution["fair"] += 1
        else:
            distribution["poor"] += 1
    average = round(sum(numbers) / len(numbers)) if numbers else None
    scored = [f for f in functions if isinstance(f, dict) and isinstance(f.get("score"), int)]
    worst = sorted(scored, key=lambda f: (f["score"], str(f.get("id", ""))))[:10]
    copied["health"] = {
        "available": True,
        "score": average,
        "grade": grade_of(average),
        "function_count": len(numbers),
        "healthy_ratio": round((distribution["excellent"] + distribution["good"]) / len(numbers), 4) if numbers else None,
        "distribution": distribution,
        "thresholds": limits,
        "formula": FORMULA,
        "basis": "以函数为单位按固定公式扣分后取算术平均；不做加权，不按时长或历史趋势修正。",
        "worst": [{"id": f.get("id"), "score": f["score"], "grade": f.get("score_grade")} for f in worst],
        "notes": list(NOTES),
    }
    return copied
