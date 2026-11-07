import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

export function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, render: (element) => act(() => root.render(element)) };
}

export function button(label, container = document) {
  const match = [...container.querySelectorAll('button')]
    .find((element) => (element.getAttribute('aria-label') || element.textContent.trim()) === label);
  assert.ok(match, `Missing button "${label}"`);
  return match;
}

export function click(element) {
  act(() => element.click());
}

export function typeValue(element, value) {
  const { set } = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  act(() => {
    set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
