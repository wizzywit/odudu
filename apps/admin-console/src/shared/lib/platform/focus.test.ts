import { afterEach, expect, it } from 'vitest';
import { focusIsLost } from '#/shared/lib/platform/focus';

afterEach(() => {
  document.body.replaceChildren();
});

it('is lost on the body and held by a focused control', () => {
  expect(focusIsLost()).toBe(true);
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  expect(focusIsLost()).toBe(false);
});
