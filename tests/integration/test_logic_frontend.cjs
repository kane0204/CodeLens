const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../../code/frontend/app.js'), 'utf8');
const fragment = source.slice(source.indexOf('  const aiLogic ='), source.indexOf('  function highlightSource()'));
let sent, resolveRequest;
const file = {path: 'a.py', status: 'ok', source: 'def f(x):\n    return x + 1', functions: ['a.f']};
const context = {
  state: {result: {project: 'demo'}, file: 'a.py', fn: '', token: 'local-token', line: null},
  llmSettings: {baseUrl: 'http://model/v1', model: 'demo', apiKey: 'private-key'},
  files: () => [file], functions: () => [{id: 'a.f', file: 'a.py'}],
  render() {}, treeView: () => '', card: (title, body) => title + body,
  esc: x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  val: x => x ?? '—', arr: x => Array.isArray(x) ? x : [], button: x => x,
  AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {sent = {url, options}; return {ok: true, json: async () => ({text: '<script>unsafe</script>先检查参数再计算。', model: 'demo', file: 'a.py', line: 1, end_line: 2})};}
};
vm.createContext(context);
vm.runInContext(fragment, context);
async function main() {
  let html = context.logicView();
  assert.ok(html.includes('生成 AI 解读'));
  assert.ok(html.includes('整个文件'));
  assert.ok(!html.includes('AST 类型'));
  assert.ok(!html.includes('语句轨迹'));
  await context.explainLogic();
  assert.equal(sent.url, '/api/explain');
  const payload = JSON.parse(sent.options.body);
  assert.equal(payload.provider.api_key, 'private-key');
  assert.equal(payload.target.function, null);
  html = context.logicView();
  assert.ok(html.includes('先检查参数再计算'));
  assert.ok(html.includes('&lt;script>'));
  assert.ok(!html.includes('<script>'));
  context.state.fn = 'a.f';
  assert.ok(!context.logicView().includes('先检查参数再计算'));
  context.fetch = async () => ({ok: false, json: async () => ({error: '模型未配置'})});
  await context.explainLogic();
  assert.ok(context.logicView().includes('模型未配置'));
  context.fetch = () => new Promise(resolve => {resolveRequest = resolve;});
  const pending = context.explainLogic();
  assert.ok(context.logicView().includes('AI 正在阅读源码'));
  context.resetAiLogic();
  resolveRequest({ok: true, json: async () => ({text: 'OLD_RESULT'})});
  await pending;
  assert.ok(!context.logicView().includes('OLD_RESULT'));
  console.log('AI logic view and request lifecycle: PASS');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
