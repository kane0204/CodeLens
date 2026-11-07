// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { ErrorBoundary } from '../../codelens-prototype/src/components/ErrorBoundary.tsx';
import { logger } from '../../codelens-prototype/src/lib/logger.ts';
import { button, click, mount } from './dom.mjs';

test('a render crash shows a recovery panel and matching diagnostic ID', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const download = vi.spyOn(logger, 'download').mockImplementation(() => {});
  const virtualConsole = jsdom.virtualConsole;
  const emit = virtualConsole.emit.bind(virtualConsole);
  const browserErrors = vi.spyOn(virtualConsole, 'emit').mockImplementation((event, ...args) => {
    if (event === 'jsdomError' && /Not implemented: navigation|Uncaught.*DO_NOT_LOG/.test(String(args[0]))) {
      return true;
    }
    return emit(event, ...args);
  });
  logger.clear();
  function Crash() {
    throw new Error('token=DO_NOT_LOG');
  }
  const { render, container } = mount();
  render(<ErrorBoundary><p>Ready</p></ErrorBoundary>);
  assert.equal(container.textContent, 'Ready');
  render(<ErrorBoundary><Crash /></ErrorBoundary>);
  assert.match(container.querySelector('h1').textContent, /界面遇到问题/);
  const error = logger.entries().find((entry) => entry.message === 'render_crash');
  assert.match(error.context.error_id, /^[a-z0-9]+$/);
  assert.ok(container.textContent.includes(error.context.error_id));
  assert.equal(error.context.message, 'token=<redacted>');
  click(button('下载日志', container));
  assert.equal(download.mock.calls.length, 1);
  click(button('重新加载', container));
  assert.ok(browserErrors.mock.calls.some(([event, value]) =>
    event === 'jsdomError' && /Not implemented: navigation/.test(String(value))));
});
