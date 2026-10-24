"""Tests for the design example only; not production-engine acceptance tests."""
from dataclasses import FrozenInstanceError, replace
from hashlib import sha256
import unittest

from domain_model import (AnalysisReference, Evidence, EvidenceType, ReviewDecision,
                          ReviewFinding, ReviewReport, SourceLocation)


def reference(status="complete"):
    return AnalysisReference("run-1", sha256(b"test-input").hexdigest(), "0.2.0", "rules-v1", status)


def finding(report_id="report-1", finding_id="finding-1", file="src/main.py"):
    return ReviewFinding(report_id, finding_id, "A3-IO",
                         Evidence(SourceLocation(file, 7, 7), EvidenceType.INFERENCE, "medium"),
                         "局部 open 路径未见匹配异常处理")


class DomainModelTests(unittest.TestCase):
    def test_value_equality_and_immutability(self):
        a=SourceLocation("src/main.py",1,2)
        self.assertEqual(a,SourceLocation("src/main.py",1,2))
        with self.assertRaises(FrozenInstanceError):
            a.start_line=3

    def test_invalid_location(self):
        for args in [("../x.py",1,1),("C:/x.py",1,1),("x.py",0,1),("x.py",3,2),("x.py",True,2)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                SourceLocation(*args)

    def test_inference_requires_confidence(self):
        with self.assertRaises(ValueError):
            Evidence(SourceLocation("a.py",1,1),EvidenceType.INFERENCE)

    def test_fact_and_inference_are_distinct(self):
        with self.assertRaises(ValueError):
            Evidence(SourceLocation("a.py",1,1),EvidenceType.FACT,"high")

    def test_entity_identity_survives_review(self):
        item=finding()
        changed=replace(item,decision=ReviewDecision.CONFIRMED)
        self.assertEqual(item,changed)
        self.assertNotEqual(item,replace(item,report_id="another-report"))
        self.assertNotEqual(item.decision,changed.decision)

    def test_aggregate_owns_entity(self):
        report=ReviewReport("report-1",reference(),("src/main.py",))
        with self.assertRaises(ValueError):
            report.add_finding(finding(report_id="another-report"))
        with self.assertRaises(ValueError):
            report.add_finding(finding(file="outside.py"))

    def test_duplicate_identity_rejected(self):
        report=ReviewReport("report-1",reference(),("src/main.py",)).add_finding(finding())
        with self.assertRaises(ValueError):
            report.add_finding(finding())

    def test_unreviewed_cannot_finalize(self):
        report=ReviewReport("report-1",reference(),("src/main.py",)).add_finding(finding())
        with self.assertRaises(ValueError):
            report.finalize()

    def test_review_does_not_rewrite_analysis_evidence(self):
        report=ReviewReport("report-1",reference(),("src/main.py",)).add_finding(finding())
        reviewed=report.review("finding-1",ReviewDecision.FALSE_POSITIVE)
        self.assertEqual(reviewed.findings[0].evidence,report.findings[0].evidence)
        self.assertEqual(report.findings[0].decision,ReviewDecision.UNREVIEWED)
        self.assertEqual(reviewed.report_id,report.report_id)
        self.assertEqual(reviewed.finalize().state,"finalized")

    def test_finalized_is_immutable(self):
        report=ReviewReport("report-1",reference(),("src/main.py",)).finalize()
        with self.assertRaises(ValueError):
            report.add_finding(finding())

    def test_empty_and_failed_not_passed(self):
        for state in ("empty","failed"):
            with self.subTest(state=state), self.assertRaises(ValueError):
                ReviewReport("report-1",reference(state),()).finalize()

    def test_partial_requires_explicit_acknowledgment(self):
        report=ReviewReport("report-1",reference("partial"),("src/main.py",))
        with self.assertRaises(ValueError):
            report.finalize()
        self.assertEqual(report.acknowledge_partial_coverage().finalize().state,"finalized")
        self.assertEqual(report.analysis.status,"partial")

    def test_constructor_also_guards_invariants(self):
        with self.assertRaises(ValueError):
            ReviewReport("report-1",reference(),("src/main.py",),(finding(),),"finalized")

    def test_unknown_finding_and_invalid_decision(self):
        report=ReviewReport("report-1",reference(),("src/main.py",))
        with self.assertRaises(ValueError):
            report.review("missing",ReviewDecision.CONFIRMED)
        with self.assertRaises(ValueError):
            report.review("missing","confirmed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
