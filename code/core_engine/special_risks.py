"""Compose evidence-backed, language-aware risk categories for the workbench."""
from __future__ import annotations

import ast
import re

ORDER = {"critical": 0, "warning": 1, "info": 2}

CATEGORIES = (
    ("suspicious-dependency", "可疑依赖调用", "调用目标或高风险系统 API 无法静态确认。"),
    ("duplicate-implementation", "重复实现", "不同位置存在相同或高度相似的实现。"),
    ("unhandled-exception", "未处理异常", "I/O、外部调用或空异常分支缺少可恢复处理。"),
    ("hardcoded-secret", "硬编码敏感信息", "敏感字段直接使用字面量赋值。"),
    ("dead-code", "死代码", "当前分析范围内没有发现其他引用。"),
    ("unchecked-assumption", "假设未校验", "直接使用参数、下标或返回值，但没有显式边界检查。"),
    ("comment-mismatch", "注释与实现不一致", "未完成、临时或占位注释与当前实现可能冲突。"),
    ("excessive-defense", "过度防御", "异常分支被静默吞掉，或防御代码没有提供有效恢复。"),
)

RISKY_CALL = re.compile(
    r"(?:eval|exec|system|popen|subprocess|child_process|spawn|"
    r"Runtime|ProcessBuilder|Class\.forName|reflect|shell_exec)",
    re.I,
)


def _finding_items(findings, rule_ids):
    return [
        {
            "severity": item.get("severity", "info"),
            "file": item.get("file"),
            "line": item.get("line"),
            "message": item.get("message"),
            "evidence_type": item.get("evidence_type", "inference"),
            "confidence": item.get("confidence"),
            "finding_id": item.get("id"),
        }
        for item in findings
        if item.get("rule_id") in rule_ids
    ]


def build(result):
    findings = list(result.get("findings") or [])
    graph = result.get("graph") or {}

    suspicious = []
    for call in graph.get("calls") or []:
        expression = str(call.get("expression") or "")
        if call.get("status") == "unresolved" or RISKY_CALL.search(expression):
            suspicious.append({
                "severity": "warning" if RISKY_CALL.search(expression) else "info",
                "file": call.get("file"),
                "line": call.get("line"),
                "message": f"调用 {expression or '未知目标'} 无法确认目标或属于高风险系统调用。",
                "evidence_type": call.get("evidence_type", "inference"),
                "confidence": "medium" if RISKY_CALL.search(expression) else "low",
            })

    duplicates = []
    for group in result.get("duplicates") or []:
        occurrences = group.get("occurrences") or []
        if len(occurrences) < 2:
            continue
        first = occurrences[0]
        for duplicate in occurrences[1:]:
            duplicates.append({
                "severity": "info",
                "file": duplicate.get("file"),
                "line": duplicate.get("line"),
                "message": f"与 {first.get('file')}:{first.get('line')} 存在相同实现。",
                "evidence_type": "inference",
                "confidence": "medium",
            })

    comment_items = list(_finding_items(findings, {"CMT-01"}))
    assumption_items = list(_finding_items(findings, {"VAL-01"}))
    comment_pattern = re.compile(r"(?:\bTODO\b|\bFIXME\b|\bHACK\b|not\s+implemented|未实现|临时|占位)", re.I)
    for record in result.get("files") or []:
        source = record.get("source")
        path = record.get("path")
        if not isinstance(source, str) or record.get("status") != "ok":
            continue
        if not path.endswith(".py"):
            continue
        for line_no, line in enumerate(source.splitlines(), 1):
            stripped = line.lstrip()
            if comment_pattern.search(line) and (
                stripped.startswith(("//", "#", "/*", "*")) or "<!--" in line
            ):
                comment_items.append({
                    "severity": "info", "file": path, "line": line_no,
                    "message": "注释包含未完成、临时或占位说明，可能与当前实现不一致。",
                    "evidence_type": "inference", "confidence": "low",
                })
        try:
            tree = ast.parse(source, feature_version=(3, 11))
        except (SyntaxError, ValueError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            params = {arg.arg for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs}
            guards = any(isinstance(item, (ast.If, ast.Assert)) for item in ast.walk(node))
            direct = any(
                isinstance(item, ast.Subscript)
                and isinstance(item.value, ast.Name)
                and item.value.id in params
                for item in ast.walk(node)
            )
            if direct and not guards:
                assumption_items.append({
                    "severity": "info", "file": path, "line": node.lineno,
                    "message": f"{node.name} 直接下标访问参数，未发现边界或存在性校验。",
                    "evidence_type": "inference", "confidence": "low",
                })

    buckets = {
        "suspicious-dependency": suspicious,
        "duplicate-implementation": duplicates,
        "unhandled-exception": _finding_items(findings, {"A3-IO", "EXC-01"}),
        "hardcoded-secret": _finding_items(findings, {"A4"}),
        "dead-code": _finding_items(findings, {"A5-DEAD"}),
        "unchecked-assumption": assumption_items,
        "comment-mismatch": comment_items,
        "excessive-defense": _finding_items(findings, {"A8-DEFENSIVE"}),
    }
    categories = []
    for ident, label, description in CATEGORIES:
        items = sorted(
            buckets[ident],
            key=lambda item: (
                ORDER.get(item.get("severity"), 9),
                item.get("file") or "",
                item.get("line") or 0,
            ),
        )
        severity = min(
            (item.get("severity", "info") for item in items),
            key=lambda value: ORDER.get(value, 9),
            default="info",
        )
        categories.append({
            "id": ident,
            "label": label,
            "description": description,
            "severity": severity,
            "count": len(items),
            "items": items[:30],
            "truncated": len(items) > 30,
        })
    return {
        "categories": categories,
        "total": sum(item["count"] for item in categories),
        "flagged_categories": sum(1 for item in categories if item["count"]),
    }
