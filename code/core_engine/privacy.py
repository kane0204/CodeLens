"""检测具有较高置信度的隐私数据与凭据字面量。

发现只描述命中的数据类型。命中值不会写入规则发现、日志或导出的报告。
"""
from __future__ import annotations

import re

from . import levels


_PATTERNS = (
    (
        re.compile(r"(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)"),
        "疑似中国大陆身份证号",
        levels.SEVERITY_CRITICAL,
        "删除真实身份证信息；确需测试时使用明确标注的合成数据。",
    ),
    (
        re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
        "疑似中国大陆手机号",
        levels.SEVERITY_WARNING,
        "移除真实手机号，或改用脱敏值和测试专用号码。",
    ),
    (
        re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])"),
        "疑似电子邮箱地址",
        levels.SEVERITY_WARNING,
        "移除真实邮箱地址，或使用项目约定的虚构测试邮箱。",
    ),
    (
        re.compile(r"(?<![\w-])sk-[A-Za-z0-9_-]{20,}"),
        "疑似 API 密钥",
        levels.SEVERITY_CRITICAL,
        "立即撤销并轮换该密钥，只通过环境变量或密钥管理服务读取。",
    ),
    (
        re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])"),
        "疑似云访问密钥",
        levels.SEVERITY_CRITICAL,
        "立即撤销并轮换该访问密钥，避免把凭据写进源码。",
    ),
    (
        re.compile(r"(?<![\w])gh[pousr]_[A-Za-z0-9]{20,}"),
        "疑似代码托管平台令牌",
        levels.SEVERITY_CRITICAL,
        "立即撤销该令牌，并通过安全的凭据管理方式注入。",
    ),
)


def findings(source, path):
    """按原始行号生成凭据信息发现，仅记录类型、位置和建议。

    正则匹配只用于判定是否命中，匹配到的值不进入发现对象。
    """
    results = []
    for line_number, line in enumerate(source.splitlines(), 1):
        for pattern, label, severity, suggestion in _PATTERNS:
            if not pattern.search(line):
                continue
            results.append({
                "rule_id": levels.RULE_PRIVACY,
                "severity": severity,
                "file": path,
                "line": line_number,
                "message": f"检测到{label}；具体值已隐藏。",
                "suggestion": suggestion,
                "evidence_type": levels.EVIDENCE_FACT,
                "actual": None,
                "threshold": None,
                "confidence": levels.CONFIDENCE_HIGH,
            })
    return results
