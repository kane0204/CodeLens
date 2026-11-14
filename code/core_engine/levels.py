"""Shared string labels for findings: rule ids, severity, confidence, evidence.

Pure literals with no imports, so any module can import this safely. Keeping the
labels in one place avoids duplicated string literals (S1192) and makes the
finding contract the single source of truth for its vocabulary.
"""
from __future__ import annotations

# --- Rule ids -------------------------------------------------------------

RULE_CC = "CC-01"
RULE_LEN = "LEN-01"
RULE_DEPTH = "DEPTH-01"
RULE_A4 = "A4"
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

# --- Severity -------------------------------------------------------------

SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

# --- Confidence -----------------------------------------------------------

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

# --- Evidence type --------------------------------------------------------

EVIDENCE_FACT = "fact"
EVIDENCE_INFERENCE = "inference"
