import importlib.util
import unittest
from pathlib import Path


class BenchmarkTests(unittest.TestCase):
    def test_reviewed_samples_match_labels(self):
        benchmark = Path(__file__).resolve().parents[2] / 'tests' / 'evaluate_solid.py'
        spec = importlib.util.spec_from_file_location('evaluate_solid', benchmark)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.evaluate()
        self.assertEqual(report['projects'], 5)
        self.assertTrue(report['coverage_gaps'], 'external inheritance must remain visible')
        for rule, row in report['per_rule'].items():
            self.assertEqual((row['fp'], row['fn']), (0, 0), rule)
