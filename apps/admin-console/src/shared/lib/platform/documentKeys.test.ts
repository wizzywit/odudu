import { afterEach, expect, it, vi } from 'vitest';
import { focusedElement, listenToKeys } from '#/shared/lib/platform/documentKeys';

afterEach(() => {
  document.body.replaceChildren();
});

it('hears keys on the page until it is told to stop', () => {
  const heard = vi.fn<(event: KeyboardEvent) => void>();
  const stop = listenToKeys(heard);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  expect(heard).toHaveBeenCalledTimes(1);
});

it('names the focused element, or the page when no control has the focus', () => {
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  expect(focusedElement()).toBe(button);
  button.blur();
  expect(focusedElement()).toBe(document.body);
});
