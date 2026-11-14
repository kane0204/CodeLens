import assert from 'node:assert/strict';
import {
  analyzeProject, ApiError, errorText, explainCode, fetchStatus, isAbortError, readCachedReview, reviewProject, toBase64,
} from '../../codelens-prototype/src/api/client.ts';

const token = 'unit-token';
const settings = { baseUrl: 'https://model.invalid/v1', model: 'model-a', apiKey: 'fake-key' };
const reviewRequest = { project: 'demo', files: [{ path: 'main.py', content: 'pass' }], settings };
const ignoreProgress = () => {};

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

test('status requests an uncached token and applies response defaults', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    assert.equal(url, '/api/status');
    assert.equal(options.cache, 'no-store');
    return Response.json({ ready: true, token, api_revision: '2' });
  });
  vi.stubGlobal('window', { setTimeout, clearTimeout });

  assert.deepEqual(await fetchStatus(), {
    ready: true, token, engine_version: '', api_revision: 2, capabilities: [],
  });
});

test('status rejects a ready response without a token', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ready: true }));
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  await assert.rejects(fetchStatus(), { name: 'ApiError', status: 200, message: /令牌/ });
});

test('status handles non-OK responses and timeout without waiting for the network', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    let finish;
    const slowResponse = new Promise((resolve) => { finish = resolve; });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockReturnValueOnce(slowResponse);
    await assert.rejects(fetchStatus(), { status: 503 });
    const timedOut = assert.rejects(fetchStatus(), { code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5000);
    await timedOut;
    finish(Response.json({ ready: true, token }));
  } finally {
    vi.useRealTimers();
  }
});

test('base64 preserves binary bytes across the encoding chunk boundary', () => {
  const bytes = Uint8Array.from({ length: 0x8000 + 257 }, (_, index) => index % 256);
  assert.deepEqual(Buffer.from(toBase64(bytes.buffer), 'base64'), Buffer.from(bytes));
  assert.equal(toBase64(new ArrayBuffer(0)), '');
});

test('analyze sends original file bytes and reports progress in order', async () => {
  const data = { summary: { parsed: 2 }, files: [], findings: [] };
  const progress = [];
  const { signal } = new AbortController();
  const bytes = Uint8Array.of(0, 255, 13, 10);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    assert.equal(url, '/api/analyze');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-CodeLens-Token'], token);
    assert.equal(options.signal, signal);
    const body = JSON.parse(options.body);
    assert.equal(body.project, 'demo');
    assert.deepEqual(body.files.map(({ path, content_base64 }) =>
      [path, Buffer.from(content_base64, 'base64')]), [
      ['main.py', Buffer.from('print("中文")\r\n')],
      ['app.js', Buffer.from(bytes)],
    ]);
    return Response.json(data);
  });

  const result = await analyzeProject({
    project: 'demo',
    files: [
      { path: 'main.py', file: new File(['print("中文")\r\n'], 'main.py') },
      { path: 'app.js', file: new File([bytes], 'app.js') },
    ],
  }, token, (event) => progress.push(event), signal);

  assert.deepEqual(result, data);
  assert.equal(fetch.mock.calls.length, 1);
  assert.deepEqual(progress.map(({ phase, done, total }) => [phase, done, total]), [
    ['read', 0, 2], ['read', 1, 2], ['read', 2, 2], ['upload', 2, 2], ['done', 2, 2],
  ]);
});

test('analyze stops before upload if cancelled while reading a file', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { assert.fail('unexpected upload'); });
  const controller = new AbortController();
  const file = { arrayBuffer: async () => {
    controller.abort();
    return new ArrayBuffer(0);
  } };
  await assert.rejects(analyzeProject({
    project: 'demo', files: [{ path: 'main.py', file }],
  }, token, ignoreProgress, controller.signal), isAbortError);
  assert.equal(fetch.mock.calls.length, 0);
});

test('a file read error names the position without leaking the source path', async () => {
  const file = { arrayBuffer: async () => { throw new Error('secret/path.py'); } };
  const fetch = vi.spyOn(globalThis, 'fetch');
  await assert.rejects(analyzeProject({
    project: 'demo', files: [{ path: 'secret/path.py', file }],
  }, token, ignoreProgress, new AbortController().signal), (error) =>
    error instanceof ApiError && /第 1 个/.test(error.message) && !error.message.includes('secret/path.py'));
  assert.equal(fetch.mock.calls.length, 0);
});

test('analyze rejects HTTP errors and incomplete success responses without reporting done', async () => {
  const responses = [
    Response.json({ error: { message: 'invalid token' } }, { status: 403 }),
    Response.json({ summary: {}, files: [] }),
  ];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift());
  const request = { project: 'demo', files: [{ path: 'main.py', file: new File(['pass'], 'main.py') }] };
  const progress = [];
  const { signal } = new AbortController();
  const onProgress = (event) => progress.push(event.phase);
  await assert.rejects(analyzeProject(request, token, onProgress, signal),
    { name: 'ApiError', status: 403, message: 'invalid token' });
  await assert.rejects(analyzeProject(request, token, onProgress, signal),
    { name: 'ApiError', message: /数据格式不完整/ });
  assert.deepEqual(progress, ['read', 'read', 'upload', 'read', 'read', 'upload']);
});

test('analyze rejects an empty selection and a response that is not JSON', async () => {
  const { signal } = new AbortController();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not JSON'));
  await assert.rejects(analyzeProject({ project: 'demo', files: [] }, token, ignoreProgress, signal),
    { name: 'ApiError', message: /没有可分析/ });
  assert.equal(fetch.mock.calls.length, 0);
  await assert.rejects(analyzeProject({
    project: 'demo', files: [{ path: 'app.js', file: new File(['run()'], 'app.js') }],
  }, token, ignoreProgress, signal), { name: 'ApiError', message: /数据为空/ });
});

test('explain sends target and provider settings and fills optional fields', async () => {
  const target = { file: 'main.py', scope: 'file' };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, { body }) => {
    assert.equal(url, '/api/explain');
    assert.deepEqual(JSON.parse(body), {
      project: 'demo', files: reviewRequest.files, target, include_context: true,
      provider: { base_url: settings.baseUrl, model: settings.model, api_key: settings.apiKey },
    });
    return Response.json({ text: '说明' });
  });
  const result = await explainCode({ ...reviewRequest, target }, token, new AbortController().signal);
  assert.equal(result.text, '说明');
  assert.equal(result.file, 'main.py');
  assert.equal(result.line, null);
  assert.deepEqual(result.citations, []);
});

test('explain omits blank settings and rejects HTTP errors, null and empty output', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ message: 'provider offline' }, { status: 502 }))
    .mockResolvedValueOnce(Response.json(null))
    .mockResolvedValueOnce(Response.json({ text: '  ' }));
  const { signal } = new AbortController();
  const request = {
    ...reviewRequest, target: { file: 'main.py', scope: 'file' },
    settings: { baseUrl: '', model: '', apiKey: '' },
  };
  await assert.rejects(explainCode(request, token, signal), { status: 502, message: 'provider offline' });
  assert.equal(Object.hasOwn(JSON.parse(fetch.mock.calls[0][1].body), 'provider'), false);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(explainCode(request, token, signal), { message: /未返回有效解读/ });
  }
});

test('review assembles split UTF-8 and NDJSON events, including an unterminated final line', async () => {
  const event = { stage: 'read', done: 1, total: 2, label: '已阅读' };
  const report = { scope: 'project', sections: {} };
  const bytes = Buffer.from(JSON.stringify({ type: 'progress', ...event }) + '\n\n'
    + JSON.stringify({ type: 'result', result: report }));
  const split = bytes.indexOf(Buffer.from(event.label)) + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, { body, headers }) => {
    assert.equal(url, '/api/review');
    assert.equal(headers['X-CodeLens-Token'], token);
    assert.deepEqual(JSON.parse(body).provider,
      { base_url: settings.baseUrl, model: settings.model, api_key: settings.apiKey });
    return new Response(stream);
  });
  const progress = [];
  assert.deepEqual(await reviewProject(reviewRequest, token, (item) => progress.push(item),
    new AbortController().signal), report);
  assert.deepEqual(progress, [event]);
});

for (const { title, body, status, message } of [
  { title: 'server error event', body: '{"type":"error","error":"timeout"}\n', status: 502, message: /timeout/ },
  { title: 'malformed NDJSON', body: '{broken\n', status: 0, message: /格式无效/ },
  { title: 'null NDJSON event', body: 'null\n', status: 0, message: /格式无效/ },
  { title: 'array NDJSON event', body: '[]\n', status: 0, message: /格式无效/ },
  { title: 'stream without result', body: '\n', status: 0, message: /未返回结果/ },
]) {
  test(`review rejects ${title}`, async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body));
    await assert.rejects(reviewProject(reviewRequest, token, ignoreProgress, new AbortController().signal),
      (error) => error instanceof ApiError && error.status === status && message.test(error.message));
  });
}

test('review handles an HTTP error and a successful response without a stream', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ error: 'not authorized' }, { status: 403 }))
    .mockResolvedValueOnce(new Response(null));
  const { signal } = new AbortController();
  await assert.rejects(reviewProject(reviewRequest, token, ignoreProgress, signal),
    { status: 403, message: 'not authorized' });
  await assert.rejects(reviewProject(reviewRequest, token, ignoreProgress, signal),
    { message: /不支持读取/ });
});

test('HTTP failures accept a plain JSON string and fall back for a non-JSON response', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json('backend busy', { status: 503 }))
    .mockResolvedValueOnce(new Response('non-JSON', { status: 503 }));
  const request = { ...reviewRequest, settings: { baseUrl: '', model: '', apiKey: '' } };
  const { signal } = new AbortController();
  await assert.rejects(reviewProject(request, token, ignoreProgress, signal),
    { status: 503, message: 'backend busy' });
  await assert.rejects(reviewProject(request, token, ignoreProgress, signal),
    { status: 503, message: /AI 审查失败/ });
  assert.equal(Object.hasOwn(JSON.parse(fetch.mock.calls[0][1].body), 'provider'), false);
});

test('error text preserves API and ordinary error messages and explains connection failures', () => {
  assert.equal(errorText(new ApiError('from API'), 'fallback'), 'from API');
  assert.equal(errorText(new ApiError('from API', 400, 'refused', 'ab12cd34'), 'fallback'),
    'from API（错误编号 ab12cd34）');
  assert.equal(errorText(new Error('local error'), 'fallback'), 'local error');
  assert.match(errorText(new TypeError('fetch failed'), 'fallback'), /分析服务未启动/);
  assert.equal(errorText(null, 'fallback'), 'fallback');
});

test('review preserves correlation IDs, handles unknown events and unlocks the stream', async () => {
  const { signal } = new AbortController();
  const body = [
    { type: 'extension' }, { type: 'progress', stage: 'read' },
    { type: 'error', error: 'timeout', error_id: 'ab12cd34' },
  ].map((event) => JSON.stringify(event)).join('\n');
  const streamed = new Response(body);
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      error: { message: 'blocked', code: 'refused' }, request_id: 'deadbeef',
    }, { status: 400 }))
    .mockResolvedValueOnce(streamed);
  await assert.rejects(reviewProject(reviewRequest, token, ignoreProgress, signal), {
    message: 'blocked', status: 400, code: 'refused', requestId: 'deadbeef',
  });
  await assert.rejects(reviewProject(reviewRequest, token, ignoreProgress, signal),
    { message: 'timeout', status: 502, requestId: 'ab12cd34' });
  assert.equal(streamed.body.locked, false);
});

test('cached review reads only the local cache and handles HTTP errors', async () => {
  const saved = { scope: 'file', sections: {} };
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: saved })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'offline' }), { status: 503 }));
  const request = { ...reviewRequest, scope: 'file' };
  const signal = new AbortController().signal;
  assert.deepEqual(await readCachedReview(request, token, signal), saved);
  assert.equal(fetch.mock.calls[0][0], '/api/review/cached');
  assert.equal(JSON.parse(fetch.mock.calls[0][1].body).scope, 'file');
  await assert.rejects(readCachedReview(request, token, signal), /offline/);
});
