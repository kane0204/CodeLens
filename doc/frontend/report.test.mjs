import assert from 'node:assert/strict';
import { exportReport } from '../../codelens-prototype/src/lib/export.ts';
import {
  ccClass, compareText, confidenceLabel, evidenceLabel, formatNumber, formatPercent, moduleName,
  ruleName, severityBadgeClass, sortByKey, truncateMiddle,
} from '../../codelens-prototype/src/lib/format.ts';
import { finding, projectResult, report } from './fixtures.mjs';

function captureDownload() {
  const anchor = { click: vi.fn(), remove: vi.fn(), setAttribute: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append } });
  const schedule = vi.fn((callback) => callback());
  vi.stubGlobal('window', { setTimeout: schedule });
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return {
    async read(format, index = 0) {
      assert.equal(anchor.download, `codelens-report.${format}`);
      assert.equal(anchor.href, 'blob:report');
      assert.deepEqual(append.mock.calls[index], [anchor]);
      assert.equal(anchor.click.mock.calls.length, index + 1);
      assert.equal(anchor.remove.mock.calls.length, index + 1);
      assert.equal(schedule.mock.calls[index][1], 1000);
      assert.deepEqual(revoke.mock.calls[index], ['blob:report']);
      const [blob] = createUrl.mock.calls[index];
      return { text: await blob.text(), type: blob.type };
    },
  };
}

test('JSON export strips source by default without changing the analysis result', async () => {
  const download = captureDownload();
  const result = projectResult();
  const original = result.files[0].source;
  exportReport(result, 'json', { includeAi: false, includeSource: false, review: report });
  const { text, type } = await download.read('json');
  const data = JSON.parse(text);
  assert.equal(type, 'application/json;charset=utf-8');
  assert.equal(data.files[0].source, '');
  assert.equal(Object.hasOwn(data, 'ai_review'), false);
  assert.equal(result.files[0].source, original);
  exportReport(result, 'json', { includeAi: true, includeSource: true, review: report });
  const included = JSON.parse((await download.read('json', 1)).text);
  assert.equal(included.files[0].source, original);
  assert.deepEqual(included.ai_review, report);
});

test('CSV export escapes quotes and neutralizes spreadsheet formulas', async () => {
  const download = captureDownload();
  exportReport(projectResult({ findings: [{ ...finding, message: '=SUM(1,2)', suggestion: 'Use "quotes"' }] }),
    'csv', { includeAi: false, includeSource: false, review: null });
  const { text, type } = await download.read('csv');
  assert.equal(type, 'text/csv;charset=utf-8');
  const [header, row] = text.split('\r\n');
  assert.equal(header, 'id,rule_id,severity,evidence_type,file,line,message,suggestion,actual,threshold,confidence');
  assert.ok(row.includes(`"'=SUM(1,2)","Use ""quotes"""`));
});

test('Markdown includes chosen review sections and escapes report fields', async () => {
  const download = captureDownload();
  const result = projectResult({
    project: 'a|b', errors: [{ file: 'broken.py', line: 4, message: '<invalid>' }],
    health: { score: 89, grade: '良好', formula: '100 - 11' },
    class_metrics: [{ id: 'Worker', wmc: 2, dit: null, cbo: 0, lcom: 1 }],
    duplicates: [{ occurrences: [{ file: 'main.py', line: 8 }, { file: 'copy.py', line: 9 }] }],
    solid: { limitations: ['Known bases only'], coverage_gaps: [{ class: 'C', file: 'a.py', line: 1, reason: 'external' }] },
    graph: { class_relations: [{ source: 'A', target: 'B', kind: 'composition', file: 'a.py', line: 2 }] },
  });
  exportReport(result, 'md', { includeAi: true, includeSource: false, review: report });
  const { text, type } = await download.read('md');
  assert.equal(type, 'text/markdown;charset=utf-8');
  for (const expected of ['a\\|b', '\\<invalid\\>', 'Complex branch', 'Logic', 'Design notes', 'Risk notes',
    'WMC=2 DIT=未知', 'main.py:8 / copy.py:9', 'A → B', 'Known bases only', '89 · 良好']) {
    assert.ok(text.includes(expected), expected);
  }
  exportReport(projectResult({ findings: [], limitations: [] }), 'md',
    { includeAi: true, includeSource: false, review: null });
  assert.match((await download.read('md', 1)).text, /本次尚未生成 AI 审查/);
  exportReport(result, 'md', { includeAi: false, includeSource: false, review: report });
  assert.doesNotMatch((await download.read('md', 2)).text, /Design notes|Risk notes/);
});

test('formatter distinguishes missing evidence, metrics and confidence from zero', () => {
  assert.deepEqual(['fact', 'inference', undefined].map(evidenceLabel), ['事实', '推断', '—']);
  assert.deepEqual([null, undefined, '', 'HIGH', 'low', 'unrated', 0.754].map(confidenceLabel),
    ['—', '—', '—', '高', '低', 'unrated', '75%']);
  assert.deepEqual([undefined, null, Number.NaN, 0].map(formatNumber), ['—', '—', '—', '0']);
  assert.deepEqual([undefined, null, Infinity, 0, 0.495].map(formatPercent), ['—', '—', '—', '0%', '50%']);
  assert.deepEqual([null, 10, 11, 20, 21].map(ccClass), ['', '', 'text-[#c2410c]', 'text-[#c2410c]', 'text-[#b91c1c]']);
  assert.match(severityBadgeClass('critical'), /fecaca/);
  assert.match(severityBadgeClass('warning'), /fed7aa/);
  assert.match(severityBadgeClass('info'), /e7e5e4/);
  assert.equal(ruleName('CC-01'), '圈复杂度');
  assert.equal(ruleName('NEW-RULE'), 'NEW-RULE');
});

test('module names, truncation and sorting preserve significant input', () => {
  assert.equal(moduleName('pkg/__init__.py'), 'pkg');
  assert.equal(moduleName('src/widgets/index.TSX'), 'src.widgets');
  assert.equal(moduleName('src/main.go'), 'src.main');
  assert.equal(truncateMiddle('short', 5), 'short');
  assert.equal(truncateMiddle('abcdefghi', 7), 'abc…ghi');
  const items = [{ key: 2 }, { key: null }, { key: 1 }, { key: 1 }];
  assert.deepEqual(sortByKey(items, (item) => item.key), [items[2], items[3], items[0], items[1]]);
  assert.deepEqual(items.map((item) => item.key), [2, null, 1, 1]);
  assert.equal(compareText(null, undefined), 0);
  assert.equal(compareText('a', 'b'), -1);
  assert.equal(compareText('z', 'b'), 1);
});
