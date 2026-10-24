"""Executable DDD design example; not wired into the production analysis API.

Uses immutable copies: a command returns a new root with the same identity.
Synthetic data belongs in tests only; running this module creates no findings.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from pathlib import PurePosixPath
import re


def relative_file(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("源码相对路径不能为空")
    value = value.replace("\\", "/")
    path = PurePosixPath(value)
    if (path.is_absolute() or ".." in path.parts or ":" in value
            or "\x00" in value or not value.endswith(".py")):
        raise ValueError("源码路径必须是项目内的 Python 相对路径")
    return str(path)


class EvidenceType(str, Enum):
    FACT = "fact"
    INFERENCE = "inference"


class ReviewDecision(str, Enum):
    UNREVIEWED = "unreviewed"
    CONFIRMED = "confirmed"
    FALSE_POSITIVE = "false_positive"
    FOLLOW_UP = "follow_up"


@dataclass(frozen=True, slots=True)
class SourceLocation:
    """Value object: equal path and range mean equal values; no independent ID."""
    file: str
    start_line: int
    end_line: int

    def __post_init__(self):
        object.__setattr__(self, "file", relative_file(self.file))
        if (type(self.start_line) is not int or type(self.end_line) is not int
                or self.start_line < 1 or self.end_line < self.start_line):
            raise ValueError("源码范围必须满足 1 <= start_line <= end_line")


@dataclass(frozen=True, slots=True)
class Evidence:
    location: SourceLocation
    kind: EvidenceType
    confidence: str | None = None

    def __post_init__(self):
        if not isinstance(self.location, SourceLocation) or not isinstance(self.kind, EvidenceType):
            raise ValueError("证据类型与源码位置无效")
        if self.kind == EvidenceType.INFERENCE and self.confidence not in {"low", "medium", "high"}:
            raise ValueError("推断必须提供 low/medium/high 置信度")
        if self.kind == EvidenceType.FACT and self.confidence is not None:
            raise ValueError("此示例中事实证据不使用推断置信度")


@dataclass(frozen=True, slots=True)
class AnalysisReference:
    run_id: str
    input_digest: str
    engine_version: str
    rules_version: str
    status: str

    def __post_init__(self):
        if not all(isinstance(v, str) and v.strip() for v in
                   (self.run_id, self.engine_version, self.rules_version)):
            raise ValueError("分析身份及版本不能为空")
        if not re.fullmatch(r"[0-9a-f]{64}", self.input_digest):
            raise ValueError("输入摘要必须为小写 SHA-256 十六进制值")
        if self.status not in {"complete", "partial", "failed", "empty"}:
            raise ValueError("未知的分析覆盖状态")


@dataclass(frozen=True, slots=True, eq=False)
class ReviewFinding:
    """Entity: identity is (report_id, finding_id), even when review changes."""
    report_id: str
    finding_id: str
    rule_id: str
    evidence: Evidence
    message: str
    decision: ReviewDecision = ReviewDecision.UNREVIEWED

    def __post_init__(self):
        if not all(isinstance(v, str) and v.strip() for v in
                   (self.report_id, self.finding_id, self.rule_id, self.message)):
            raise ValueError("发现项身份、规则和描述不能为空")
        if not isinstance(self.evidence, Evidence) or not isinstance(self.decision, ReviewDecision):
            raise ValueError("发现项证据或复核状态无效")

    @property
    def identity(self) -> tuple[str, str]:
        return self.report_id, self.finding_id

    def __eq__(self, other):
        if not isinstance(other, ReviewFinding):
            return NotImplemented
        return self.identity == other.identity

    def __hash__(self):
        return hash(self.identity)


@dataclass(frozen=True, slots=True, eq=False)
class ReviewReport:
    """Aggregate root: validates membership, review commands and finalization."""
    report_id: str
    analysis: AnalysisReference
    source_files: tuple[str, ...]
    _findings: tuple[ReviewFinding, ...] = ()
    state: str = "draft"
    partial_coverage_acknowledged: bool = False

    def __post_init__(self):
        if not isinstance(self.report_id, str) or not self.report_id.strip():
            raise ValueError("报告身份不能为空")
        if not isinstance(self.analysis, AnalysisReference):
            raise ValueError("报告必须引用一次具体分析")
        paths = tuple(relative_file(p) for p in self.source_files)
        if len(set(paths)) != len(paths):
            raise ValueError("源码文件身份不能重复")
        object.__setattr__(self, "source_files", tuple(sorted(paths)))
        object.__setattr__(self, "_findings", tuple(self._findings))
        if self.state not in {"draft", "finalized"}:
            raise ValueError("未知报告状态")
        if type(self.partial_coverage_acknowledged) is not bool:
            raise ValueError("部分覆盖确认标记必须为布尔值")
        ids = set()
        for item in self._findings:
            if not isinstance(item, ReviewFinding) or item.report_id != self.report_id:
                raise ValueError("不能将其他报告的实体纳入本聚合")
            if item.finding_id in ids:
                raise ValueError("报告内发现项身份不能重复")
            ids.add(item.finding_id)
            if item.evidence.location.file not in paths:
                raise ValueError("证据必须来自本次分析的源码清单")
        if self.state == "finalized":
            self._validate_finalization()

    @property
    def findings(self) -> tuple[ReviewFinding, ...]:
        return self._findings

    def _require_draft(self):
        if self.state != "draft":
            raise ValueError("完成的复核报告不可继续修改，请创建新报告")

    def add_finding(self, item: ReviewFinding) -> ReviewReport:
        self._require_draft()
        return replace(self, _findings=self._findings + (item,))

    def review(self, finding_id: str, decision: ReviewDecision) -> ReviewReport:
        self._require_draft()
        if not isinstance(decision, ReviewDecision) or decision == ReviewDecision.UNREVIEWED:
            raise ValueError("复核命令必须给出明确决定")
        if not any(f.finding_id == finding_id for f in self._findings):
            raise ValueError("发现项不属于本报告")
        return replace(self, _findings=tuple(
            replace(f, decision=decision) if f.finding_id == finding_id else f
            for f in self._findings))

    def acknowledge_partial_coverage(self) -> ReviewReport:
        self._require_draft()
        if self.analysis.status != "partial":
            raise ValueError("只有部分完成的分析需要此确认")
        return replace(self, partial_coverage_acknowledged=True)

    def _validate_finalization(self):
        if self.analysis.status in {"failed", "empty"}:
            raise ValueError("失败或空输入不能被标为复核完成")
        if self.analysis.status == "partial" and not self.partial_coverage_acknowledged:
            raise ValueError("必须明确确认未覆盖的文件，不能将部分分析当作完整覆盖")
        if any(f.decision == ReviewDecision.UNREVIEWED for f in self._findings):
            raise ValueError("仍有发现项未人工复核")

    def finalize(self) -> ReviewReport:
        self._require_draft()
        self._validate_finalization()
        return replace(self, state="finalized")

    def __eq__(self, other):
        if not isinstance(other, ReviewReport):
            return NotImplemented
        return self.report_id == other.report_id

    def __hash__(self):
        return hash(self.report_id)
