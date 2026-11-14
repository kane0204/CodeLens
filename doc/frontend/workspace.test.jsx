// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import App from '../../codelens-prototype/src/App.tsx';
import { FileTree } from '../../codelens-prototype/src/components/FileTree.tsx';
import { HealthPopover } from '../../codelens-prototype/src/components/HealthPopover.tsx';
import { ReviewMarkdown } from '../../codelens-prototype/src/components/ReviewMarkdown.tsx';
import { logger } from '../../codelens-prototype/src/lib/logger.ts';
import { button, click, mount, typeValue } from './dom.mjs';
import { designFinding, finding, fn, path, projectResult, report } from './fixtures.mjs';

const mocked = vi.hoisted(() => ({ context: {}, selectedReview: vi.fn(), cachedReview: vi.fn() }));
vi.mock('../../codelens-prototype/src/api/client.ts', async (original) => ({
  ...await original(),
  reviewProject: mocked.selectedReview,
  readCachedReview: mocked.cachedReview,
}));
vi.mock('../../codelens-prototype/src/state/AppState.tsx', () => ({
  useApp: () => mocked.context,
}));

beforeEach(() => {
  mocked.context = {
    route: 'overview', result: projectResult(),
    scopedReviews: new Map(),
    saveScopedReview: (_result, key, output) => mocked.context.scopedReviews.set(key, output), file: path, phase: '', status: 'ready',
    settings: { baseUrl: '', model: '', apiKey: '' },
    toasts: [], errors: [], ignored: {}, treeSearch: '', expandedRules: ['CC-01'],
    go: vi.fn(), openSource: vi.fn(), openFunction: vi.fn(), locateFinding: vi.fn(),
    toggleRule: vi.fn(), selectFile: vi.fn(), setTreeSearch: vi.fn(), openSettings: vi.fn(), runExport: vi.fn(),
    runReview: vi.fn(), cancelReview: vi.fn(), closeSource: vi.fn(), cancelReimport: vi.fn(),
    confirmReimportAction: vi.fn(), copyText: vi.fn(), requestReimport: vi.fn(),
    applySettings: vi.fn(() => true), startAnalysis: vi.fn(), startFromTransfer: vi.fn(),
    connect: vi.fn(), cancelAnalysis: vi.fn(), returnToResult: vi.fn(), closeSettings: vi.fn(),
    saveSettings: vi.fn(), setExportAi: vi.fn(), setExportSource: vi.fn(), exportAi: true,
    exportSource: false,
  };
});

test('overview renders summary and opens or dismisses the export menu', () => {
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /复杂度参考/);
  assert.match(container.textContent, /风险分布/);
  click(button('项目结构', container));
  assert.equal(mocked.context.go.mock.calls[0][0], 'structure');
  const risks = [...container.querySelectorAll('button')].find((node) => node.textContent.includes('风险条目'));
  click(risks);
  assert.deepEqual(mocked.context.go.mock.lastCall, ['risks']);
  click(button('导出报告', container));
  click(container.querySelector('[role="menuitem"]'));
  assert.deepEqual(mocked.context.runExport.mock.calls, [['md']]);
  assert.equal(container.querySelector('[role="menu"]'), null);
  click(button('导出报告', container));
  const [ai, source] = container.querySelectorAll('[role="menu"] input');
  click(ai);
  click(source);
  assert.deepEqual(mocked.context.setExportAi.mock.calls, [[false]]);
  assert.deepEqual(mocked.context.setExportSource.mock.calls, [[true]]);
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  assert.equal(container.querySelector('[role="menu"]'), null);
  click(button('导出报告', container));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(container.querySelector('[role="menu"]'), null);
});

test('structure displays package and symbol rows, and opens the selected function', () => {
  mocked.context.route = 'structure';
  const result = mocked.context.result;
  result.files.push(
    { ...result.files[0], path: 'lib/tool.js', module: 'lib.tool', functions: [] },
    { ...result.files[0], path: 'src.py', module: 'src', functions: [] },
  );
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /Python 3\.11 1/);
  assert.match(container.textContent, /src\.main\.Worker/);
  const target = container.querySelector(`button[title="${fn.id}"]`);
  assert.ok(target);
  click(target);
  assert.deepEqual(mocked.context.openFunction.mock.calls, [[fn.id]]);
  click(button('查看文件逻辑', container));
  assert.deepEqual(mocked.context.selectFile.mock.calls, [[path]]);
  assert.deepEqual(mocked.context.go.mock.lastCall, ['logic']);
  click(button('源码', container));
  assert.deepEqual(mocked.context.openSource.mock.lastCall, [{ title: '类定义', path, line: 1, endLine: 2 }]);
  click(button('按被依赖次数 ↕', container));
  assert.ok(button('按被依赖次数 ↓', container));
  const packages = [...container.querySelectorAll('tbody tr td:first-child')].map((row) => row.textContent);
  assert.equal(packages[0], 'src');
  assert.deepEqual(new Set(packages.slice(1)), new Set(['lib', '（根目录）']));
});

test('logic renders the report, links an in-range citation, and copies Markdown', () => {
  Object.assign(mocked.context, { route: 'logic', aiReview: report });
  const { render, container } = mount();
  render(<App />);
  click(button('src/main.py:L1–2', container));
  assert.deepEqual(mocked.context.openSource.mock.calls, [[{ title: '源码引用', path, line: 1, endLine: 2 }]]);
  const copy = [...container.querySelectorAll('button')].find((element) => /复制/.test(element.textContent));
  assert.ok(copy);
  click(copy);
  assert.deepEqual(mocked.context.copyText.mock.calls, [[report.sections.logic.markdown]]);
  const scrollTo = vi.fn();
  const scrollPanel = container.querySelector('[data-line="2"]').closest('details').parentElement;
  scrollPanel.scrollTo = scrollTo;
  mocked.context.highlight = { start: 2, end: 2 };
  render(<App />);
  assert.match(container.querySelector('[data-line="2"].hl').textContent, /return flag/);
  assert.deepEqual(scrollTo.mock.lastCall, [{ top: 0, behavior: 'smooth' }]);
});

test('logic keeps the project review available when the selected source is missing', () => {
  Object.assign(mocked.context, { route: 'logic', result: projectResult({ files: [] }), aiReview: report });
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /分析结果不含源码/);
  assert.ok(button('src/main.py:L1–2', container));
});

test('metrics groups findings and allows jumping to the worst function', () => {
  mocked.context.route = 'metrics';
  mocked.context.result = projectResult({
    duplicates: [{ fingerprint: '12345678', occurrences: [{ file: 'src/main.py', line: 1 }] }],
    quality_notes: ['AST metrics'],
  });
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /高复杂度函数/);
  assert.match(container.textContent, /Complex branch/);
  click(container.querySelector(`button[title="${fn.id}"]`));
  assert.deepEqual(mocked.context.openFunction.mock.calls, [[fn.id]]);
  click(button(`${path}:1`, container));
  assert.deepEqual(mocked.context.locateFinding.mock.lastCall, [finding.id]);
  click(button('全部收起', container));
  assert.deepEqual(mocked.context.toggleRule.mock.calls, [['CC-01']]);
  click(container.querySelector('button[aria-expanded="true"]:not([aria-haspopup])'));
  assert.deepEqual(mocked.context.toggleRule.mock.lastCall, ['CC-01']);
  assert.match(container.textContent, /12345678/);
  assert.match(container.textContent, /AST metrics/);
});

test('design and risk routes filter findings and render their own report sections', () => {
  Object.assign(mocked.context, { route: 'solid', aiReview: report });
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /Design notes/);
  assert.match(container.textContent, /Known classes only/);
  assert.match(container.textContent, new RegExp(designFinding.message));
  assert.doesNotMatch(container.textContent, new RegExp(finding.message));
  click(button(`${path}:1`, container));
  assert.deepEqual(mocked.context.locateFinding.mock.lastCall, [designFinding.id]);

  mocked.context.route = 'risks';
  render(<App />);
  assert.match(container.textContent, /Risk notes/);
  assert.match(container.textContent, new RegExp(finding.message));
  assert.doesNotMatch(container.textContent, new RegExp(designFinding.message));
  click(button(`${path}:1`, container));
  assert.deepEqual(mocked.context.locateFinding.mock.lastCall, [finding.id]);
});

test('upload page and source/reimport dialogs render the corresponding state', () => {
  mocked.context.importing = true;
  const { render, container } = mount();
  render(<App />);
  assert.ok(container.querySelector('input[webkitdirectory]'));
  mocked.context.importing = false;
  mocked.context.sourceTarget = { path, title: '源码引用', line: 2, endLine: 2 };
  mocked.context.confirmReimport = true;
  mocked.context.toasts = [{ id: 1, kind: 'success', message: 'Analysis ready' }];
  render(<App />);
  assert.match(document.querySelector('.source-line.hl').textContent, /return flag/);
  assert.match(container.textContent, /Analysis ready/);
  click(button('确认重新导入'));
  assert.equal(mocked.context.confirmReimportAction.mock.calls.length, 1);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(mocked.context.closeSource.mock.calls.length, 1);
  assert.equal(mocked.context.cancelReimport.mock.calls.length, 1);
});

test('Markdown renders lists and emphasis and leaves invalid references non-interactive', () => {
  const { render, container } = mount();
  render(<ReviewMarkdown
    markdown={'## Heading\r\n\r\n- **One**\r\n2. Two\r\n\r\nUnknown [missing.py:L9]'}
    citations={[{ file: 'missing.py', line: 9, end_line: 9, valid: false }]}
  />);
  assert.equal(container.querySelector('h3').textContent, 'Heading');
  assert.deepEqual([...container.querySelectorAll('li')].map((node) => node.textContent), ['One', 'Two']);
  assert.equal(container.querySelector('strong').textContent, 'One');
  assert.match(container.querySelector('p').textContent, /missing\.py:L9/);
  assert.equal(container.querySelector('button'), null);
});

test('model settings protect the key by default, submit edited values and clear a draft', () => {
  mocked.context.settingsOpen = true;
  mocked.context.settingsError = 'Invalid URL';
  const { render } = mount();
  render(<App />);
  const dialog = document.querySelector('[role="dialog"]');
  const base = dialog.querySelector('#llm-base-url');
  const model = dialog.querySelector('#llm-model');
  const key = dialog.querySelector('#llm-api-key');
  assert.equal(key.type, 'password');
  assert.match(dialog.querySelector('[role="alert"]').textContent, /Invalid URL/);
  typeValue(base, 'https://model.invalid/v1');
  typeValue(model, 'unit');
  typeValue(key, 'fake-key');
  click(button('显示', dialog));
  assert.equal(key.type, 'text');
  click(button('保存设置', dialog));
  assert.deepEqual(mocked.context.saveSettings.mock.calls, [
    [{ baseUrl: 'https://model.invalid/v1', model: 'unit', apiKey: 'fake-key' }],
  ]);
  click(button('清空草稿', dialog));
  assert.deepEqual([base.value, model.value, key.value, key.type], ['', '', '', 'password']);
  const download = vi.spyOn(logger, 'download').mockImplementation(() => {});
  click(button('下载诊断日志', dialog));
  assert.equal(download.mock.calls.length, 1);
});

test('upload routes file selection and drops through settings validation and renders progress', () => {
  mocked.context.importing = true;
  const { render, container } = mount();
  render(<App />);
  const input = container.querySelector('input[type=file]');
  const choose = vi.spyOn(input, 'click').mockImplementation(() => {});
  const base = container.querySelector('input[placeholder="https://api.example.com/v1"]');
  const model = container.querySelector('input[placeholder="gpt-4o-mini"]');
  const key = container.querySelector('input[type=password]');
  typeValue(base, 'https://model.invalid/v1');
  typeValue(model, 'unit');
  typeValue(key, 'fake-key');
  for (const field of [base, model, key]) {
    act(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  }
  mocked.context.applySettings.mockReturnValueOnce(false);
  click(button('选择文件夹', container));
  assert.equal(choose.mock.calls.length, 0);
  assert.ok(container.querySelector('[role="alert"]'));
  click(button('选择文件夹', container));
  assert.equal(choose.mock.calls.length, 1);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.deepEqual(mocked.context.applySettings.mock.lastCall, [
    { baseUrl: 'https://model.invalid/v1', model: 'unit', apiKey: 'fake-key' },
  ]);

  const file = new File(['pass'], 'main.py');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  assert.deepEqual(mocked.context.startAnalysis.mock.lastCall, [[{ file, path: 'main.py' }], true]);
  const dropZone = button('选择文件夹', container).parentElement;
  const dataTransfer = { items: [], files: [file] };
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer });
    act(() => dropZone.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(dataTransfer.dropEffect, 'copy');
  assert.deepEqual(mocked.context.startFromTransfer.mock.calls, [[dataTransfer, true]]);

  Object.assign(mocked.context, {
    busy: true, phase: 'AI 正在分析', progress: 1, progressTotal: 3, eta: 61,
    errors: ['read failed'], ignored: { '.md': 2, '.png': 1 },
  });
  render(<App />);
  assert.match(container.querySelector('[role="status"]').textContent, /1\/3.*1 分 1 秒/s);
  assert.equal(container.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
  assert.match(container.textContent, /read failed/);
  assert.match(container.textContent, /\.md：2；\.png：1/);
  click(button('取消', container));
  assert.equal(mocked.context.cancelAnalysis.mock.calls.length, 1);
});

test('disabling automatic review hides fields and allows both import methods', () => {
  mocked.context.importing = true;
  const { render, container } = mount();
  render(<App />);
  const toggle = container.querySelector('[role="switch"]');
  const base = () => container.querySelector('input[placeholder="https://api.example.com/v1"]');
  typeValue(base(), 'draft');
  click(toggle);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(base(), null);
  const input = container.querySelector('input[type=file]');
  const choose = vi.spyOn(input, 'click').mockImplementation(() => {});
  click(button('选择文件夹', container));
  assert.equal(choose.mock.calls.length, 1);
  const file = new File(['pass'], 'main.py');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  assert.deepEqual(mocked.context.startAnalysis.mock.lastCall, [[{ file, path: 'main.py' }], false]);
  const dataTransfer = { items: [], files: [file] };
  act(() => button('选择文件夹', container).parentElement.dispatchEvent(
    Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer }),
  ));
  assert.deepEqual(mocked.context.startFromTransfer.mock.lastCall, [dataTransfer, false]);
  assert.equal(mocked.context.applySettings.mock.calls.length, 0);
  click(toggle);
  assert.equal(base().value, 'draft');
});

test('overview distinguishes unavailable complexity and an empty risk report', () => {
  const result = projectResult();
  result.findings = [];
  result.summary = { ...result.summary, max_cc: null, average_cc: null, findings: 0 };
  mocked.context.result = result;
  const { render, container } = mount();
  render(<App />);
  assert.match(container.textContent, /引擎未产出圈复杂度/);
  assert.match(container.textContent, /当前分析没有风险条目/);
});

test('offline upload can reconnect or return to the last result', () => {
  Object.assign(mocked.context, { importing: true, status: 'offline' });
  const { render, container } = mount();
  render(<App />);
  click(button('重新连接', container));
  click(button('查看上一次结果', container));
  assert.equal(mocked.context.connect.mock.calls.length, 1);
  assert.equal(mocked.context.returnToResult.mock.calls.length, 1);
  mocked.context.status = 'connecting';
  render(<App />);
  assert.match(container.querySelector('[role="status"]').textContent, /正在连接本机/);
});

test('health popover shows the formula and dismisses on Escape or pointer leave', () => {
  vi.useFakeTimers();
  try {
    const { render, container } = mount();
    render(<HealthPopover health={{ score: 89, grade: '良好', formula: '100 - 11',
      basis: 'Arithmetic mean', notes: ['Only supported metrics'] }} />);
    const trigger = button('查看健康度计算方式', container);
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 20, right: 30, top: window.innerHeight - 40, bottom: window.innerHeight - 2,
    });
    act(() => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    let panel = document.querySelector('[role="tooltip"]');
    assert.match(panel.textContent, /89 · 良好/);
    assert.match(panel.textContent, /100 - 11/);
    assert.match(panel.textContent, /Only supported metrics/);
    assert.ok(parseInt(panel.style.top, 10) < window.innerHeight - 40);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    act(() => trigger.focus());
    act(() => trigger.blur());
    panel = document.querySelector('[role="tooltip"]');
    act(() => panel.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    act(() => vi.advanceTimersByTime(140));
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    click(trigger);
    assert.ok(document.querySelector('[role="tooltip"]'));
  } finally {
    vi.useRealTimers();
  }
});

test('file tree sorts directories and files, filters by path and selects error rows', () => {
  const main = projectResult().files[0];
  const files = [
    { ...main, path: 'z/late.js' }, main, { ...main, path: 'src/error.py', status: 'error', functions: [] },
  ];
  const onSelect = vi.fn();
  const onSearch = vi.fn();
  const { render, container } = mount();
  const tree = (search) => <FileTree files={files} classes={projectResult().classes}
    selected={path} search={search} onSearch={onSearch} onSelect={onSelect} />;
  render(tree(''));
  assert.deepEqual([...container.querySelectorAll('button')].map((item) => item.title),
    ['src/error.py', path, 'z/late.js']);
  click(container.querySelector('button[title="src/error.py"]'));
  assert.deepEqual(onSelect.mock.calls, [['src/error.py']]);
  typeValue(container.querySelector('[type="search"]'), 'error');
  assert.deepEqual(onSearch.mock.calls, [['error']]);
  render(tree(' ERROR '));
  assert.equal(container.querySelectorAll('button').length, 1);
  render(tree('missing'));
  assert.match(container.textContent, /没有匹配的文件/);
});

test('review routes show busy and failure states and retain access to retry', () => {
  const { render, container } = mount();
  mocked.context.result.solid.coverage_gaps = [
    { class: 'Worker', file: path, line: 1, reason: 'external base' },
  ];
  for (const [route, startLabel, busyText] of [
    ['solid', '生成设计检查', 'AI 正在评估结构设计'],
    ['risks', '生成风险评估', 'AI 正在评估严重危害风险'],
  ]) {
    Object.assign(mocked.context, { route, reviewError: 'Timeout', reviewBusy: false });
    render(<App />);
    assert.match(container.querySelector('[role="alert"]').textContent, /Timeout/);
    click(button(startLabel, container));
    mocked.context.reviewBusy = true;
    mocked.context.reviewProgress = { stage: 'read', done: 1, total: 2, label: 'Reading batch' };
    render(<App />);
    assert.ok(button(startLabel, container).disabled);
    assert.ok(container.textContent.includes(busyText));
    click(button('取消', container));
  }
  assert.equal(mocked.context.runReview.mock.calls.length, 2);
  assert.equal(mocked.context.cancelReview.mock.calls.length, 2);
});

test('logic enables only the selected scope and submits its parsed sources', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local' });
  const files = mocked.context.result.files;
  files.push(
    { ...files[0], path: 'src/utils/helper.py' },
    { ...files[0], path: 'src/broken.py', status: 'error' },
    { ...files[0], path: 'src-other/other.py' },
  );
  mocked.selectedReview.mockResolvedValue(report);
  const { render, container } = mount();
  render(<App />);
  const fileButton = () => button('解读当前文件', container);
  const folderButton = () => button('解读当前文件夹', container);
  assert.equal(fileButton().disabled, false);
  assert.equal(folderButton().disabled, true);
  await act(async () => fileButton().click());
  assert.deepEqual(mocked.selectedReview.mock.lastCall[0].files.map((item) => item.path), [path]);

  click([...container.querySelectorAll('summary')].find((item) => item.querySelector('[data-folder-name]')?.textContent === 'src'));
  assert.equal(fileButton().disabled, true);
  assert.equal(folderButton().disabled, false);
  await act(async () => folderButton().click());
  assert.deepEqual(mocked.selectedReview.mock.lastCall[0].files.map((item) => item.path), [path, 'src/utils/helper.py']);

  click(container.querySelector('button[title="' + path + '"]'));
  assert.equal(fileButton().disabled, false);
  assert.equal(folderButton().disabled, true);
});

test('logic shows scoped review failures and enables retry', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local' });
  mocked.selectedReview.mockRejectedValueOnce(new Error('Model unavailable'));
  const { render, container } = mount();
  render(<App />);
  const action = button('解读当前文件', container);
  await act(async () => action.click());
  assert.match(container.querySelector('[role="alert"]').textContent, /Model unavailable/);
  assert.equal(action.disabled, false);
});

test('folder review shows batch progress from the review stream', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local' });
  let complete;
  mocked.selectedReview.mockImplementationOnce((_request, _token, progress) => {
    progress({ stage: 'read', label: '正在阅读源码', done: 1, total: 3 });
    return new Promise((resolve) => { complete = resolve; });
  });
  const { render, container } = mount();
  render(<App />);
  click([...container.querySelectorAll('summary')].find((item) => item.querySelector('[data-folder-name]')?.textContent === 'src'));
  click(button('解读当前文件夹', container));
  assert.match(container.querySelector('[role="status"]').textContent, /正在阅读源码.*1\/3/);
  await act(async () => complete(report));
});

test('batch review pauses between targets, resumes, and shows cached reports when selecting folders', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local' });
  mocked.selectedReview.mockClear();
  let finish;
  const scopedReport = (request) => ({
    ...report,
    sections: { ...report.sections, logic: { ...report.sections.logic, markdown: request.project } },
  });
  mocked.selectedReview
    .mockImplementationOnce(async (request) => scopedReport(request))
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementation(async (request) => scopedReport(request));
  const { render, container } = mount();
  render(<App />);
  await act(async () => button('一键解读所有文件和文件夹', container).click());
  assert.match(container.textContent, /已解读 1\/2 项/);
  click(button('暂停', container));
  assert.equal(mocked.selectedReview.mock.lastCall[3].aborted, true);
  await act(async () => finish(report));
  await act(async () => button('继续解读', container).click());
  assert.match(container.textContent, /已解读 2\/2 项/);
  assert.match(container.textContent, /文件 · src\/main.py/);
  click([...container.querySelectorAll('summary')].find((item) => item.querySelector('[data-folder-name]')?.textContent === 'src'));
  assert.match(container.textContent, /文件夹 · src/);
  mocked.context.route = 'metrics';
  render(<App />);
  mocked.context.route = 'logic';
  render(<App />);
  assert.match(container.textContent, /已解读 2\/2 项/);
  assert.match(container.textContent, /文件 · src\/main.py/);
  assert.equal(mocked.selectedReview.mock.calls.length, 3);
});

test('logic can pause a project review started during import', () => {
  Object.assign(mocked.context, { route: 'logic', reviewBusy: true });
  const { render, container } = mount();
  render(<App />);
  assert.match(container.querySelector('[role="status"]').textContent, /AI 正在通读项目源码/);
  click(button('暂停', container));
  assert.equal(mocked.context.cancelReview.mock.calls.length, 1);
});

test('batch reviews later files after a transport error and marks finished targets', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local', aiReview: report, reviewError: '旧项目审查错误' });
  mocked.context.result.files.push({ ...mocked.context.result.files[0], path: 'src/nested/helper.py' });
  mocked.selectedReview.mockReset()
    .mockRejectedValueOnce(new Error('模型连接中断'))
    .mockResolvedValue(report);
  const { render, container } = mount();
  render(<App />);
  await act(async () => button('一键解读所有文件和文件夹', container).click());
  assert.deepEqual(mocked.selectedReview.mock.calls.map(([request]) => [
    request.scope, request.files.map((file) => file.path),
  ]), [
    ['file', [path]],
    ['file', ['src/nested/helper.py']],
    ['folder', ['src/nested/helper.py']],
    ['folder', [path, 'src/nested/helper.py']],
  ]);
  assert.match(container.textContent, /已解读 3\/4 项/);
  assert.match(container.textContent, /当前文件尚未解读/);
  assert.match(container.querySelector('[role="alert"]').textContent, /src\/main.py.*连接中断/);
  assert.doesNotMatch(container.textContent, /旧项目审查错误/);
  assert.match(container.querySelector('button[title="src/nested/helper.py"]').textContent, /已解读/);
});

test('logic restores a saved file review after reimport without starting a model request', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local', capabilities: ['review-checkpoints'] });
  const scoped = { ...report, scope: 'file', sections: {
    logic: { ...report.sections.logic, markdown: '已保存的文件解读' },
  } };
  mocked.selectedReview.mockClear();
  mocked.cachedReview.mockResolvedValueOnce(scoped);
  const { render, container } = mount();
  await act(async () => render(<App />));
  render(<App />);
  assert.match(container.textContent, /已保存的文件解读/);
  assert.match(container.textContent, /已解读 1\/2 项/);
  assert.equal(mocked.selectedReview.mock.calls.length, 0);
  assert.equal(mocked.cachedReview.mock.lastCall[0].scope, 'file');
});

test('a failed cache lookup leaves manual generation available', async () => {
  Object.assign(mocked.context, { route: 'logic', token: 'local', capabilities: ['review-checkpoints'] });
  mocked.cachedReview.mockRejectedValueOnce(new Error('offline'));
  const { render, container } = mount();
  await act(async () => render(<App />));
  assert.equal(button('解读当前文件', container).disabled, false);
});
