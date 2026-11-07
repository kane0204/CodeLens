import assert from 'node:assert/strict';
import { attachGlobalErrorHandlers, logger, redactText } from '../../codelens-prototype/src/lib/logger.ts';

beforeEach(() => {
  logger.clear();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

test('redaction handles controls, bearer credentials and quoted secrets', () => {
  const redacted = redactText('api_key="one two" token: SECOND Bearer tok.en\n\tstatus=400');
  assert.match(redacted, /api_key=<redacted>/);
  assert.match(redacted, /token=<redacted>/);
  assert.match(redacted, /Bearer <redacted>/);
  assert.doesNotMatch(redacted, /one|two|SECOND|tok\.en|\n|\t/);
  assert.equal(redactText('x'.repeat(250)).length, 201);
});

test('logger sanitizes context, keeps scalar metadata and protects its buffer', () => {
  logger.warn('api', 'request failed', {
    project: 'private-project', file_path: 'private/path.py', apiKey: 'fake-key',
    error: 'token=forbidden', duration_ms: 5, cancelled: false, detail: { key: 1 }, absent: null,
  });
  const [entry] = logger.entries();
  assert.deepEqual(entry.context, {
    project: '<redacted>', file_path: '<redacted>', apiKey: '<redacted>',
    error: 'token=<redacted>', duration_ms: 5, cancelled: false, detail: '<object>',
  });
  entry.context.apiKey = 'mutated';
  assert.equal(logger.entries()[0].context.apiKey, '<redacted>');
  assert.equal(console.warn.mock.calls.length, 1);
});

test('logger retains only the most recent 200 entries and can be cleared', () => {
  for (let index = 0; index < 205; index += 1) logger.info('unit', `message ${index}`);
  assert.equal(logger.entries().length, 200);
  assert.equal(logger.entries()[0].message, 'message 5');
  assert.equal(logger.entries().at(-1).message, 'message 204');
  logger.clear();
  assert.deepEqual(logger.entries(), []);
});

test('diagnostics download is local and revokes the temporary URL', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostics');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const link = { click: vi.fn() };
  const schedule = vi.fn((callback) => callback());
  vi.stubGlobal('document', { createElement: vi.fn(() => link) });
  vi.stubGlobal('window', { setTimeout: schedule });
  logger.debug('api', 'token=DO_NOT_EXPORT');
  logger.download();
  assert.match(link.download, /^codelens-log-.*\.json$/);
  assert.equal(link.href, 'blob:diagnostics');
  assert.equal(link.click.mock.calls.length, 1);
  assert.equal(schedule.mock.calls[0][1], 1000);
  assert.deepEqual(revoke.mock.calls, [['blob:diagnostics']]);
  const data = JSON.parse(await create.mock.calls[0][0].text());
  assert.equal(data.entries[0].message, 'token=<redacted>');
  assert.ok(Number.isFinite(Date.parse(data.exported_at)));
});

test('global error handlers attach once and redact browser errors', () => {
  attachGlobalErrorHandlers();
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  attachGlobalErrorHandlers();
  attachGlobalErrorHandlers();
  browser.dispatchEvent(Object.assign(new Event('error'), { message: 'password=DO_NOT_LOG', lineno: 12 }));
  for (const reason of [new Error('token=DO_NOT_LOG'), { secret: 'DO_NOT_LOG' }]) {
    browser.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
  }
  browser.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(logger.entries().map(({ message, context }) => [message, context]), [
    ['session.started', { restored: 0 }],
    ['uncaught_error', { message: 'password=<redacted>', line: 12 }],
    ['unhandled_rejection', { message: 'token=<redacted>' }],
    ['unhandled_rejection', { message: '<object>' }],
    ['session.ended', undefined],
  ]);
});

const storageKey = 'codelens.diag.v1';

function stubDiagnosticStorage() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

test('the last 100 sanitized non-debug events persist and restore on reload', async () => {
  const storage = stubDiagnosticStorage();
  for (let index = 0; index < 102; index += 1) logger.info('unit', 'message ' + index);
  logger.debug('unit', 'memory-only');
  logger.warn('unit', 'token=PRIVATE', { source: 'PRIVATE' });
  const snapshot = storage.getItem(storageKey);
  assert.doesNotMatch(snapshot, /PRIVATE|memory-only/);
  const saved = JSON.parse(snapshot);
  assert.equal(saved.length, 100);
  assert.equal(saved[0].message, 'message 3');
  assert.equal(saved.at(-1).message, 'token=<redacted>');

  storage.setItem(storageKey, JSON.stringify([...saved, null, { level: 'warn' }]));
  vi.resetModules();
  const { logger: reloaded } = await import('../../codelens-prototype/src/lib/logger.ts');
  assert.equal(reloaded.restoredCount(), 100);
  assert.equal(reloaded.entries().at(-1).context.source, '<redacted>');
  reloaded.clear();
  assert.equal(storage.getItem(storageKey), null);
});

test.each(['broken JSON', '{"message":"not a list"}'])('restore tolerates invalid storage %s', async (raw) => {
  const storage = stubDiagnosticStorage();
  storage.setItem(storageKey, raw);
  vi.resetModules();
  const { logger: reloaded } = await import('../../codelens-prototype/src/lib/logger.ts');
  assert.deepEqual(reloaded.entries(), []);
  reloaded.info('unit', 'new session');
  assert.equal(JSON.parse(storage.getItem(storageKey))[0].message, 'new session');
});
