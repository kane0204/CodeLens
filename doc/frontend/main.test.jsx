// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchStatus } from '../../codelens-prototype/src/api/client.ts';

vi.mock('react-dom/client', async (original) => {
  const module = await original();
  return { ...module, createRoot: vi.fn(module.createRoot) };
});

vi.mock('../../codelens-prototype/src/api/client.ts', async (original) => ({
  ...await original(),
  fetchStatus: vi.fn().mockResolvedValue({
    ready: true, token: 'unit', engine_version: 'test-engine', capabilities: [],
  }),
}));

test('entrypoint mounts the workbench in the page root and connects to the backend', async () => {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () => { await import('../../codelens-prototype/src/main.tsx'); });
    assert.equal(createRoot.mock.calls[0][0], container);
    assert.match(container.textContent, /本机服务已连接/);
    assert.ok(container.querySelector('input[webkitdirectory]'));
    assert.ok(fetchStatus.mock.calls.length > 0);
  } finally {
    act(() => createRoot.mock.results[0]?.value.unmount());
    container.remove();
  }
});
