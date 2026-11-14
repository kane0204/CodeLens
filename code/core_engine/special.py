"""Code-specific special risk report.

Every item is derived from facts the engine already produced (findings, graph,
duplicate groups). A category the engine cannot judge is returned as
``covered: False`` with an explicit reason instead of an invented empty result.
"""
from __future__ import annotations

from . import levels

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
        "severity": finding.get("severity", levels.SEVERITY_INFO),
        "file": finding.get("file"),
        "line": finding.get("line"),
        "message": finding.get("message", ""),
        "evidence_type": finding.get("evidence_type", levels.EVIDENCE_FACT),
        "confidence": finding.get("confidence"),
        "finding_id": finding.get("id"),
    }


def _items_for_rule(findings, rule):
    return [_item(item) for item in findings if item.get("rule_id") == rule]


def _suspicious_items(graph):
    unresolved = [edge for edge in (graph.get("calls") or []) if edge.get("status") == "unresolved"]
    unresolved.sort(key=lambda edge: (str(edge.get("file")), edge.get("line") or 0))
    return [
        {
            "severity": levels.SEVERITY_INFO,
            "file": edge.get("file"),
            "line": edge.get("line"),
            "message": f"调用 {edge.get('expression') or edge.get('target') or '未知目标'} 无法在本次分析范围内唯一解析。",
            "evidence_type": levels.EVIDENCE_INFERENCE,
            "confidence": levels.CONFIDENCE_LOW,
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
            "severity": levels.SEVERITY_INFO,
            "file": first.get("file"),
            "line": first.get("line"),
            "message": f"函数体结构与其他 {max(0, len(occurrences) - 1)} 处实现相同（指纹 {str(group.get('fingerprint'))[:12]}）。",
            "evidence_type": levels.EVIDENCE_FACT,
            "confidence": levels.CONFIDENCE_HIGH,
            "finding_id": None,
        })
    return items


def _nonpython_only(files):
    languages = {record.get("language") for record in files if record.get("language")}
    return bool(languages) and not any(name == "Python" or name.startswith("Python ") for name in languages)


def _category(ident, items, *, covered=True, reason=None, truncated=False):
    return {"id": ident, "covered": covered, "reason": reason,
            "truncated": truncated, "items": items[:LIMIT]}


def _rule_categories(findings, nonpython):
    return [
        _category("unhandled-exception", _items_for_rule(findings, levels.RULE_A3_IO),
                  reason="该检测仅覆盖 Python 内置 open 的局部异常处理。" if nonpython else None),
        _category("hardcoded-secret", _items_for_rule(findings, levels.RULE_A4)),
        _category("dead-code", _items_for_rule(findings, levels.RULE_A5_DEAD),
                  reason="非 Python 仅对私有/下划线命名且无调用方的函数给出推断。" if nonpython else None),
        _category("unchecked-assumption", [], covered=False,
                  reason="当前引擎未提供通用边界/假设校验检测：Python 部分见「未处理异常」，其他语言需人工复核。"),
        _category("comment-mismatch", _items_for_rule(findings, levels.RULE_CMT),
                  reason="仅识别 TODO/FIXME/占位注释，不能证明实现一定与注释冲突。"),
        _category("excessive-defense", _items_for_rule(findings, levels.RULE_A8_DEFENSIVE)),
    ]


def build(result):
    if not isinstance(result, dict):
        return {"categories": []}
    findings = [item for item in (result.get("findings") or []) if isinstance(item, dict)]
    suspicious, unresolved_count = _suspicious_items(result.get("graph") or {})
    return {"categories": [
        _category("suspicious-dependency", suspicious, truncated=unresolved_count > LIMIT),
        _category("duplicate-implementation", _duplicate_items(result.get("duplicates") or [])),
        *_rule_categories(findings, _nonpython_only(result.get("files") or [])),
    ]}
