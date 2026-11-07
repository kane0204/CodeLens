// Exercise the actual design-view renderer with backend-shaped results.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../code/frontend/app.js'), 'utf8');
const start = source.indexOf('  function solidView()');
const end = source.indexOf('  function risksView()', start);
const ids = ['SRP-01', 'OCP-01', 'LSP-01', 'ISP-01', 'DIP-01'];
const context = {
  state: {result: {solid: {checked_overrides: 1, limitations: ['未命中不等于符合'],
    coverage_gaps: [{class: 'Child', file: 'a.py', line: 4, reason: '父类未解析'}], truncated: true}}, expanded: new Set()},
  rules: () => ids,
  findings: () => [{id: 'finding-1', rule_id: 'ISP-01', file: 'a.py', line: 7,
    severity: 'warning', evidence_type: 'inference', message: '拒绝接口成员'}],
  esc: x => String(x ?? '').replaceAll('<', '&lt;'), val: x => x ?? '—',
  arr: x => Array.isArray(x) ? x : [], card: (title, body) => title + body,
  table: (headers, body) => headers.join(' ') + body, tag: x => x, evidence: x => x,
  button: x => x, ruleLabel: x => x, findingDetail: () => ''
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const html = context.solidView();
for (const id of ids) assert.ok(html.includes(id), id);
for (const text of ['拒绝接口成员', '未发现静态风险', '部分代码因', '设计规则命中']) {
  assert.ok(html.includes(text), text);
}
assert.ok(!html.includes('分析覆盖范围'));
assert.ok(!html.includes('>通过<'));
console.log('SOLID frontend rendering: PASS');
