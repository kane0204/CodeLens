// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { AppProvider, useApp } from '../../codelens-prototype/src/state/AppState.tsx';
import { analyzeProject, fetchStatus, reviewProject } from '../../codelens-prototype/src/api/client.ts';
import { exportReport } from '../../codelens-prototype/src/lib/export.ts';
import { mount } from './dom.mjs';
import { finding, fn, path, projectResult, report } from './fixtures.mjs';

vi.mock('../../codelens-prototype/src/api/client.ts', async (importOriginal) => ({
  ...await importOriginal(),
  fetchStatus: vi.fn(),
  analyzeProject: vi.fn(),
  reviewProject: vi.fn(),
}));
vi.mock('../../codelens-prototype/src/lib/export.ts', () => ({ exportReport: vi.fn() }));

const selection = [{ path: `demo/${path}`, file: new File(['pass'], 'main.py') }];
const settings = { baseUrl: 'https://model.invalid/v1', model: 'model-a', apiKey: 'fake-key' };
const ready = { token: 'unit-token', engine_version: 'unit-engine', capabilities: ['analyze'] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
  history.replaceState(null, '', '/');
  fetchStatus.mockResolvedValue(ready);
  analyzeProject.mockImplementation(async (request, _, progress) => {
    progress({ phase: 'read', done: 1, total: 2 });
    progress({ phase: 'upload', done: 2, total: 2 });
    return projectResult({ project: request.project });
  });
  reviewProject.mockImplementation(async (_, __, progress) => {
    progress({ stage: 'read', done: 1, total: 2, label: '' });
    progress({ stage: 'review', done: 2, total: 2, label: 'Done' });
    return report;
  });
});

async function renderProvider() {
  let state;
  function Capture() {
    state = useApp();
    return null;
  }
  const { render } = mount();
  render(<AppProvider><Capture /></AppProvider>);
  await act(async () => {});
  return () => state;
}

test('connect exposes ready state and can retry after an offline response', async () => {
  fetchStatus.mockRejectedValueOnce(new Error('offline'));
  const state = await renderProvider();
  assert.equal(state().status, 'offline');
  assert.match(state().errors[0], /分析服务未连接/);
  await act(() => state().connect());
  assert.equal(state().status, 'ready');
  assert.equal(state().version, ready.engine_version);
  assert.equal(state().token, ready.token);
  assert.deepEqual(state().errors, []);
});

test('analysis initializes workspace and finding navigation and export use the latest result', async () => {
  const state = await renderProvider();
  act(() => state().go('metrics'));
  assert.equal(state().importing, true);
  await act(() => state().startAnalysis(selection));
  assert.equal(state().importing, false);
  assert.equal(state().result.project, 'demo');
  assert.equal(state().file, path);
  assert.equal(state().route, 'overview');
  assert.equal(analyzeProject.mock.calls[0][1], ready.token);
  assert.equal(reviewProject.mock.calls.length, 0);

  act(() => {
    state().locateFinding(finding.id);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  assert.deepEqual(state().highlight, { start: 1, end: 1 });
  assert.equal(state().route, 'logic');
  assert.equal(state().fn, fn.id);
  act(() => {
    state().selectFile(path);
    state().setTreeSearch('run');
    state().setOverOnly(true);
    state().toggleRule('CC-01');
    state().toggleFinding(finding.id);
    state().setGraph({ tab: 'calls', entry: fn.id, chainEntry: fn.id, layout: 'radial',
      granularity: 'file', direction: 'LR', query: 'run' });
  });
  assert.equal(state().highlight, null);
  assert.deepEqual(state().expandedRules, ['CC-01']);
  assert.deepEqual(state().expandedFindings, [finding.id]);
  assert.equal(state().graphGranularity, 'file');
  assert.equal(state().graphQuery, 'run');
  act(() => {
    state().toggleRule('CC-01');
    state().toggleFinding(finding.id);
    state().runExport('json');
  });
  assert.deepEqual(state().expandedRules, []);
  assert.deepEqual(state().expandedFindings, []);
  assert.deepEqual(exportReport.mock.calls, [
    [state().result, 'json', { includeAi: true, includeSource: false, review: null, scopedReviews: new Map() }],
  ]);
});

test('settings validate and trim inputs, omit API keys from storage and enable auto-review', async () => {
  const state = await renderProvider();
  act(() => state().openSettings());
  act(() => state().saveSettings({ ...settings, baseUrl: 'https://user:pass@host.invalid' }));
  assert.match(state().settingsError, /HTTP/);
  assert.equal(state().settingsOpen, true);
  act(() => state().saveSettings({ ...settings, model: ' model-a ' }));
  assert.equal(state().settingsOpen, false);
  assert.deepEqual(state().settings, settings);
  const stored = JSON.parse(localStorage.getItem(localStorage.key(0)));
  assert.deepEqual(stored, { baseUrl: settings.baseUrl, model: settings.model });

  await act(() => state().startAnalysis(selection));
  assert.equal(state().aiReview, report);
  assert.deepEqual(reviewProject.mock.calls[0][0], {
    project: 'demo', settings, files: [{ path, content: projectResult().files[0].source }],
  });
  assert.equal(state().reviewBusy, false);
  assert.equal(state().importing, false);
});

test('configured models stay idle during static-only imports and remain available for manual review', async () => {
  const state = await renderProvider();
  act(() => state().applySettings(settings));
  await act(() => state().startAnalysis(selection, false));
  await act(() => state().startFromTransfer({ items: [], files: [selection[0].file] }, false));
  assert.ok(state().result);
  assert.equal(reviewProject.mock.calls.length, 0);
  await act(() => state().runReview());
  assert.equal(reviewProject.mock.calls.length, 1);
});

test('review failure leaves static analysis available and retry can succeed', async () => {
  const state = await renderProvider();
  act(() => state().applySettings(settings));
  reviewProject.mockRejectedValueOnce(new Error('model offline'));
  await act(() => state().startAnalysis(selection));
  assert.equal(state().result.project, 'demo');
  assert.equal(state().aiReview, null);
  assert.equal(state().importing, false);
  assert.match(state().reviewError, /model offline.*断点/);
  await act(() => state().runReview());
  assert.equal(state().aiReview, report);
  assert.equal(state().reviewError, '');
});

test('cancellation aborts the active analysis and keeps the selection screen', async () => {
  const state = await renderProvider();
  let analysisSignal;
  analyzeProject.mockImplementation((_, __, ___, signal) => new Promise((resolve, reject) => {
    analysisSignal = signal;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  let pending;
  act(() => { pending = state().startAnalysis(selection); });
  assert.equal(state().busy, true);
  await act(async () => {
    state().cancelAnalysis();
    await pending;
  });
  assert.equal(state().busy, false);
  assert.equal(analysisSignal.aborted, true);
  assert.equal(state().importing, true);
  assert.deepEqual(state().errors, ['已中止分析。']);
});

test('unsupported imports are rejected and reimport preserves the previous result', async () => {
  const state = await renderProvider();
  await act(() => state().startAnalysis([{ path: 'notes.txt', file: new File(['x'], 'notes.txt') }]));
  assert.equal(analyzeProject.mock.calls.length, 0);
  assert.equal(state().ignored['.txt'], 1);
  await act(() => state().startAnalysis(selection));
  act(() => state().requestReimport());
  assert.equal(state().confirmReimport, true);
  act(() => state().cancelReimport());
  assert.equal(state().confirmReimport, false);
  await act(async () => state().confirmReimportAction());
  assert.equal(state().importing, true);
  assert.equal(state().result.project, 'demo');
  act(() => state().returnToResult());
  assert.equal(state().importing, false);
});

test('AI cancellation retains the checkpoint message and later reports a missing provider', async () => {
  const state = await renderProvider();
  await act(() => state().startAnalysis(selection));
  await act(() => state().runReview());
  assert.match(state().toasts.at(-1).message, /先在模型设置/);
  act(() => state().applySettings(settings));
  reviewProject.mockImplementation((_, __, ___, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  let pending;
  act(() => { pending = state().runReview(); });
  assert.equal(state().reviewBusy, true);
  await act(async () => {
    state().cancelReview();
    await pending;
  });
  assert.match(state().reviewError, /已中断.*断点续跑/);
  assert.equal(state().reviewBusy, false);
});

test('file drop errors and HTTP failures remain visible without discarding an existing result', async () => {
  const state = await renderProvider();
  await act(() => state().startFromTransfer({ items: [], files: [selection[0].file] }));
  assert.ok(state().result);
  analyzeProject.mockRejectedValueOnce(new Error('engine error'));
  await act(() => state().startAnalysis(selection));
  assert.deepEqual(state().errors, ['engine error']);
  assert.ok(state().result);
  await act(() => state().startFromTransfer({ items: null }));
  assert.match(state().errors[0], /连接中断/);
});

test('settings survive reload without the API key and tolerate blocked storage', async () => {
  const state = await renderProvider();
  act(() => state().applySettings(settings));
  const second = await renderProvider();
  assert.deepEqual(second().settings, { ...settings, apiKey: '' });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage blocked');
  });
  act(() => second().saveSettings({ ...settings, model: 'temporary' }));
  assert.equal(second().settings.model, 'temporary');
  assert.match(second().toasts.at(-1).message, /浏览器无法保存设置/);
  assert.equal(write.mock.calls.length, 1);
  act(() => assert.equal(second().applySettings({ ...settings, model: 'session-only' }), true));
  assert.equal(second().settings.model, 'session-only');
});

test('clipboard fallback cleans up its textarea after copying or failure', async () => {
  const state = await renderProvider();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error()) },
  });
  const copy = vi.fn().mockReturnValueOnce(true).mockImplementation(() => { throw new Error(); });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  try {
    await act(() => state().copyText('first'));
    assert.equal(copy.mock.calls.length, 0);
    await act(() => state().copyText('second'));
    assert.deepEqual(copy.mock.calls, [['copy']]);
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(state().toasts.at(-1).kind, 'success');
    await act(() => state().copyText('third'));
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(state().toasts.at(-1).kind, 'warning');
  } finally {
    delete navigator.clipboard;
    delete document.execCommand;
  }
});

test('source navigation prefers the innermost function and handles unavailable source', async () => {
  const inner = { ...fn, id: 'src.main.run.inner', name: 'inner', end_line: 1 };
  const result = projectResult({
    functions: [fn, inner],
    findings: [finding, { ...finding, id: 'missing', file: 'missing.py', line: null }],
  });
  result.files = [{ ...result.files[0], functions: result.functions }];
  analyzeProject.mockResolvedValueOnce(result);
  const state = await renderProvider();
  await act(() => state().startAnalysis(selection));
  act(() => {
    state().locateFinding(finding.id);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  assert.equal(state().fn, inner.id);
  assert.equal(state().route, 'logic');
  act(() => state().selectFunction(fn.id));
  assert.equal(state().fn, fn.id);
  assert.equal(state().highlight, null);
  act(() => state().openFunction(inner.id));
  assert.equal(state().fn, inner.id);
  assert.equal(state().file, path);
  act(() => state().locateFinding('missing'));
  assert.match(state().toasts.at(-1).message, /没有对应源码/);
  act(() => state().openCitation({ file: path, line: 1, end_line: 2 }));
  assert.deepEqual(state().sourceTarget, { title: '源码引用', path, line: 1, endLine: 2 });
  act(() => state().closeSource());
  assert.equal(state().sourceTarget, null);
});

test('invalid or cleared settings fall back to empty defaults', async () => {
  const seed = await renderProvider();
  act(() => seed().applySettings(settings));
  const storageKey = localStorage.key(0);
  localStorage.setItem(storageKey, '{invalid');
  const state = await renderProvider();
  const empty = { baseUrl: '', model: '', apiKey: '' };
  assert.deepEqual(state().settings, empty);
  act(() => assert.equal(state().applySettings({ ...settings, baseUrl: 'invalid' }), false));
  act(() => state().applySettings(empty));
  assert.equal(localStorage.getItem(storageKey), null);
  act(() => state().applySettings(settings));
  act(() => state().openSettings());
  act(() => state().closeSettings());
  assert.equal(state().settingsOpen, false);
  act(() => state().saveSettings(empty));
  assert.equal(localStorage.getItem(storageKey), null);
});

test('developer fixture loader initializes a project and review rejects missing parsed sources', async () => {
  vi.stubEnv('DEV', true);
  try {
    const state = await renderProvider();
    const result = projectResult({ files: [] });
    act(() => window.__codelensLoadResult(result));
    assert.equal(state().result, result);
    assert.equal(state().importing, false);
    assert.equal(state().status, 'ready');
    act(() => state().applySettings(settings));
    await act(() => state().runReview());
    assert.match(state().reviewError, /没有成功解析的源码/);
    assert.equal(reviewProject.mock.calls.length, 0);
  } finally {
    vi.unstubAllEnvs();
    delete window.__codelensLoadResult;
  }
});

test('temporary notices disappear when their timers expire', async () => {
  vi.useFakeTimers();
  try {
    const state = await renderProvider();
    act(() => state().toast('Saved'));
    assert.equal(state().toasts.at(-1).message, 'Saved');
    act(() => vi.advanceTimersByTime(3600));
    assert.deepEqual(state().toasts, []);
  } finally {
    vi.useRealTimers();
  }
});

test('scoped reviews are exported with their project and cleared on new import', async () => {
  const state = await renderProvider();
  await act(() => state().startAnalysis(selection, false));
  const first = state().result;
  const scoped = { ...report, scope: 'file', sections: { logic: report.sections.logic } };
  act(() => state().saveScopedReview(first, 'file:' + path, scoped));
  act(() => state().runExport('json'));
  assert.equal(exportReport.mock.lastCall[2].scopedReviews.get('file:' + path), scoped);
  await act(() => state().startAnalysis(selection, false));
  act(() => state().saveScopedReview(first, 'file:' + path, scoped));
  assert.equal(state().scopedReviews.size, 0);
});
