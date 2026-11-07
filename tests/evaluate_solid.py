"""Run the checked-in manual review benchmark; emit reproducible JSON."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'code'))
from core_engine.engine import analyze
from core_engine import rules
from core_engine.solid import RULE_IDS


def evaluate():
    dataset = json.loads((ROOT / 'tests/fixtures/solid_labels.json').read_text(encoding='utf-8'))
    counts = {rule: {'tp': 0, 'fp': 0, 'fn': 0, 'tn': 0} for rule in RULE_IDS}
    details, gaps = [], []
    for project in dataset['projects']:
        if 'root' in project:
            root = ROOT / project['root']
            paths = sorted(root.rglob('*.py'))
            files = [{'path': p.relative_to(root).as_posix(), 'content': p.read_text(encoding='utf-8')} for p in paths]
        else:
            files = [{'path': Path(p).name, 'content': (ROOT / p).read_text(encoding='utf-8')} for p in project['files']]
        result = analyze({'files': files})
        extra = rules.evaluate(result)
        gaps.extend({'project': project['name'], **gap} for gap in extra['solid']['coverage_gaps'])
        observed = {c['id']: set() for c in result['classes']}
        for finding in extra['findings']:
            if finding['rule_id'] not in RULE_IDS:
                continue
            candidates = [c for c in result['classes'] if c['file'] == finding['file'] and c['line'] <= finding['line'] <= c['end_line']]
            if candidates:
                owner = min(candidates, key=lambda c: c['end_line'] - c['line'])
                observed[owner['id']].add(finding['rule_id'])
        for ident, actual in sorted(observed.items()):
            expected = set(project['positive'].get(ident, []))
            for rule in RULE_IDS:
                key = 'tp' if rule in expected and rule in actual else 'fn' if rule in expected else 'fp' if rule in actual else 'tn'
                counts[rule][key] += 1
            details.append({'project': project['name'], 'class': ident, 'expected': sorted(expected), 'actual': sorted(actual)})
    for row in counts.values():
        row['precision'] = round(row['tp'] / (row['tp'] + row['fp']), 4) if row['tp'] + row['fp'] else None
        row['recall'] = round(row['tp'] / (row['tp'] + row['fn']), 4) if row['tp'] + row['fn'] else None
    return {'scope': dataset['description'], 'projects': len(dataset['projects']), 'classes': len(details),
            'per_rule': counts, 'coverage_gaps': gaps, 'details': details}


if __name__ == '__main__':
    print(json.dumps(evaluate(), ensure_ascii=False, indent=2))
