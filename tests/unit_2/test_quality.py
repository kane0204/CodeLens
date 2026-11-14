import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'code'))
from backend.server import enrich
from core_engine.engine import analyze
from ai.explanation import context_for, citations_for


def analyzed(files):
    return enrich(analyze({'files': [{'path': p, 'content': s} for p, s in files.items()]}))


class QualityTests(unittest.TestCase):
    def test_class_metrics_have_hand_calculated_values(self):
        result = analyzed({'a.py': '''class Base: pass
class Counter(Base):
    def get(self): return self.value
    def change(self, value):
        if value: self.value = value
        return self.value
'''})
        row = next(c for c in result['class_metrics'] if c['id'] == 'a.Counter')
        self.assertEqual((row['wmc'], row['dit'], row['cbo'], row['lcom']), (3, 1, 1, 0))

    def test_unknown_external_base_depth_is_unknown(self):
        row = analyzed({'a.py': 'class C(External): pass'})['class_metrics'][0]
        self.assertIsNone(row['dit'])

    def test_disjoint_fields_are_not_cohesive(self):
        row = analyzed({'a.py': 'class C:\n    def a(self): return self.x\n    def b(self): return self.y\n'})['class_metrics'][0]
        self.assertEqual(row['lcom'], 1)

    def test_cross_file_composition_association_and_dependency(self):
        result = analyzed({'a.py': '''from b import Service as Impl
class C:
    dependency: Impl
    def __init__(self): self.local = Impl()
    def accept(self, value: Impl): return value
''', 'b.py': 'class Service: pass'})
        kinds = {e['kind'] for e in result['graph']['class_relations'] if e['source'] == 'a.C' and e['target'] == 'b.Service'}
        self.assertEqual(kinds, {'composition', 'association', 'dependency'})

    def test_duplicate_bodies_preserve_values_and_names(self):
        body = '\n    total = x + 1\n    if total > 2:\n        total *= 2\n    return total\n'
        result = analyzed({'a.py': 'def a(x):' + body + 'def b(x):' + body + 'def c(x):' + body.replace('x + 1', 'x + 2')})
        self.assertEqual(len(result['duplicates']), 1)
        self.assertEqual(len(result['duplicates'][0]['occurrences']), 2)
        self.assertEqual(len([f for f in result['findings'] if f['rule_id'] == 'DUP-01']), 1)
        self.assertEqual(result['summary']['findings'], len(result['findings']))
        self.assertEqual(len({f['id'] for f in result['findings']}), len(result['findings']))

    def test_small_helpers_not_reported_as_duplicates(self):
        self.assertEqual(analyzed({'a.py': 'def a(): return 1\ndef b(): return 1'})['duplicates'], [])

    def test_clones_ignore_distinct_docstrings_but_keep_original_locations(self):
        body = '\n    total = x + 1\n    if total > 2:\n        total *= 2\n    return total\n'
        source = 'def a(x):\n    """First."""' + body + 'def b(x):\n    """Second."""' + body
        group, = analyzed({'a.py': source})['duplicates']
        self.assertEqual([(row['id'], row['line']) for row in group['occurrences']], [('a.a', 1), ('a.b', 7)])

    def test_quoted_relative_annotations_resolve_and_invalid_annotations_are_skipped(self):
        result = analyzed({
            'pkg/__init__.PY': '''from .service import Service as Impl
import pkg.service as module
class Consumer:
    dependency: "Impl"
    bad_annotation: "Impl["
    def create(self, _value: "module.Service") -> "Impl":
        return self.dependency
''',
            'pkg/service.py': 'class Service: pass',
        })
        edges = [edge for edge in result['graph']['class_relations'] if edge['source'] == 'pkg.Consumer']
        self.assertEqual([(edge['target'], edge['kind'], edge['line']) for edge in edges], [
            ('pkg.service.Service', 'association', 4), ('pkg.service.Service', 'dependency', 6),
        ])

    def test_unaliased_dotted_import_resolves_qualified_annotation(self):
        result = analyzed({
            "a.py": "import pkg.service\nclass Consumer:\n    item: pkg.service.Service\n",
            "pkg/service.py": "class Service: pass",
        })
        edges = [edge for edge in result["graph"]["class_relations"] if edge["source"] == "a.Consumer"]
        self.assertEqual([(edge["target"], edge["kind"]) for edge in edges],
                         [("pkg.service.Service", "association")])

    def test_static_and_class_methods_do_not_affect_instance_cohesion(self):
        result = analyzed({'a.py': '''class C:
    def use(self): return self.value
    @staticmethod
    def helper(): return 42
    @classmethod
    def create(cls): return cls()
'''})
        row, = result['class_metrics']
        self.assertEqual((row['wmc'], row['lcom']), (3, 0))

    def test_inheritance_cycle_has_no_finite_depth(self):
        result = analyzed({
            'a.py': 'from b import B\nclass A(B): pass',
            'b.py': 'from a import A\nclass B(A): pass',
        })
        self.assertEqual(len(result['graph']['inheritance']), 2)
        self.assertEqual([row['dit'] for row in result['class_metrics']], [None, None])

    def test_quality_does_not_treat_non_python_or_unparsed_source_as_ast_clones(self):
        result = analyzed({
            'bad.py': 'def (',
            'app.js': 'class Service { run() { work(); return 0; } }',
            'pkg/main.py': 'from .models import Model\nclass Use:\n    value: Model\n',
            'pkg/models.py': 'class Model: pass',
        })
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['duplicates'], [])
        self.assertEqual([(edge['source'], edge['target'], edge['kind'])
                          for edge in result['graph']['class_relations']],
                         [('pkg.main.Use', 'pkg.models.Model', 'association')])

    def test_context_is_resolved_bounded_and_optional(self):
        r = analyzed({'a.py': 'from b import step\ndef run(x):\n    return step(x)\n', 'b.py': 'def step(x):\n    return x + 1\n', 'secret.py': 'secret = "DO_NOT_SEND"'})
        selected = next(f for f in r['files'] if f['path'] == 'a.py')
        snippets, ranges, omitted = context_for(r, selected, 2, 3)
        self.assertEqual([c['file'] for c in ranges], ['a.py', 'b.py'])
        self.assertNotIn('DO_NOT_SEND', ''.join(snippets))
        self.assertEqual(omitted, 0)
        self.assertEqual(len(context_for(r, selected, 2, 3, False)[1]), 1)

    def test_invalid_or_unsent_citations_do_not_link(self):
        refs = citations_for('说明 [a.py:L2-L3] [a.py:L900] [b.py:L1] 第 2 行',
                             [{'file': 'a.py', 'line': 2, 'end_line': 3}], 'a.py')
        self.assertEqual([r['valid'] for r in refs], [True, False, False, True])

    def test_quality_results_are_deterministic(self):
        files = {'a.py': 'class C:\n    def get(self): return self.x\n'}
        self.assertEqual(analyzed(files), analyzed(files))
