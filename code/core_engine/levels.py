"""集中定义发现对象的规则 ID、严重程度、置信度和证据类型。

常量不依赖分析模块，避免循环导入。集中定义标签可以减少重复的
字符串字面量（S1192），并让发现对象的字段值保持一致。
"""
from __future__ import annotations

# 规则 ID
# 规则 ID 会被报告、历史比较和证据引用使用。修改中文说明时保留既有 ID。

RULE_CC = "CC-01"
RULE_LEN = "LEN-01"
RULE_DEPTH = "DEPTH-01"
RULE_PARAMS = "PARAM-01"
MAX_PARAMETERS = 4
PARAMETER_SUGGESTION = "检查是否能拆分职责，或用一个对象传入一组始终一起使用的参数。"
RULE_A4 = "A4"
RULE_PRIVACY = "PRIVACY-01"
RULE_A3_IO = "A3-IO"
RULE_CYCLE = "CYCLE-01"
RULE_SRP = "SRP-01"
RULE_OCP = "OCP-01"
RULE_LSP = "LSP-01"
RULE_ISP = "ISP-01"
RULE_DIP = "DIP-01"
RULE_A5_DEAD = "A5-DEAD"
RULE_A8_DEFENSIVE = "A8-DEFENSIVE"
RULE_CMT = "CMT-01"
RULE_DUP = "DUP-01"

# 严重程度

SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

# 置信度

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

# 证据类型

EVIDENCE_FACT = "fact"
EVIDENCE_INFERENCE = "inference"
