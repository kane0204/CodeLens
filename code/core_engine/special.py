"""Code-specific special risk report.

Every item is derived from facts the engine already produced (findings, graph,
duplicate groups). A category the engine cannot judge is returned as
``covered: False`` with an explicit reason instead of an invented empty result.
"""
from __future__ import annotations

CATEGORIES = [
    ("suspicious-dependency", "可疑依赖调用"),
    ("duplicate-implementation", "重复实现"),
    ("unhandled-exception", "未处理异常"),
    ("hardcoded-secret", "硬编码敏感信息"),
    ("dead-code", "死代码"),
    ("unchecked-assumption", "假设未校验"),
    ("comment-mismatch", "注释与实现不一致"),
    ("excessive-defense", "过度防御"),
]

LIMIT = 40


def _item(finding):
    return {
        "severity": finding.get("severity", "info"),
        "file": finding.get("file"),
        "line": finding.get("line"),
        "message": finding.get("message", ""),
        "evidence_type": finding.get("evidence_type", "fact"),
        "confidence": finding.get("confidence"),
        "finding_id": finding.get("id"),
    }


def _by_rule(findings, rules):
    return [item for item in findings if item.get("rule_id") in rules]


def _suspicious_items(graph):
    unresolved = [edge for edge in (graph.get("calls") or []) if edge.get("status") == "unresolved"]
    unresolved.sort(key=lambda edge: (str(edge.get("file")), edge.get("line") or 0))
    return [
        {
            "severity": "info",
            "file": edge.get("file"),
            "line": edge.get("line"),
            "message": f"调用 {edge.get('expression') or edge.get('target') or '未知目标'} 无法在本次分析范围内唯一解析。",
            "evidence_type": "inference",
            "confidence": "low",
            "finding_id": None,
        }
        for edge in unresolved
    ], len(unresolved)


def _duplicate_items(duplicates):
    items = []
    for group in duplicates:
        occurrences = group.get("occurrences") or []
        if not occurrences:
            continue
        first = occurrences[0]
        items.append({
            "severity": "info",
            "file": first.get("file"),
            "line": first.get("line"),
            "message": f"函数体结构与其他 {max(0, len(occurrences) - 1)} 处实现相同（指纹 {str(group.get('fingerprint'))[:12]}）。",
            "evidence_type": "fact",
            "confidence": "high",
            "finding_id": None,
        })
    return items


def build(result):
    if not isinstance(result, dict):
        return {"categories": []}
    findings = [item for item in (result.get("findings") or []) if isinstance(item, dict)]
    graph = result.get("graph") or {}
    duplicates = result.get("duplicates") or []
    languages = {record.get("language") for record in (result.get("files") or []) if record.get("language")}

    def category(ident, covered, items=None, reason=None, truncated=False):
        return {"id": ident, "covered": covered, "reason": reason,
                "truncated": truncated, "items": (items or [])[:LIMIT]}

    suspicious, unresolved_count = _suspicious_items(graph)
    duplicate_items = _duplicate_items(duplicates)

    categories = [
        category("suspicious-dependency", True, suspicious, truncated=unresolved_count > LIMIT),
        category("duplicate-implementation", True, duplicate_items),
        category("unhandled-exception", True, [_item(item) for item in _by_rule(findings, {"A3-IO"})],
                 reason=None if "Python" in languages or not languages else "该检测仅覆盖 Python 内置 open 的局部异常处理。"),
        category("hardcoded-secret", True, [_item(item) for item in _by_rule(findings, {"A4"})]),
        category("dead-code", True, [_item(item) for item in _by_rule(findings, {"A5-DEAD"})],
                 reason=None if "Python" in languages or not languages else "非 Python 仅对私有/下划线命名且无调用方的函数给出推断。"),
        category("unchecked-assumption", False, [],
                 reason="当前引擎未提供通用边界/假设校验检测：Python 部分见「未处理异常」，其他语言需人工复核。"),
        category("comment-mismatch", True, [_item(item) for item in _by_rule(findings, {"CMT-01"})],
                 reason="仅识别 TODO/FIXME/占位注释，不能证明实现一定与注释冲突。"),
        category("excessive-defense", True, [_item(item) for item in _by_rule(findings, {"A8-DEFENSIVE"})]),
    ]
    return {"categories": categories}
