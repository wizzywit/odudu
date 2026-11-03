import { expect, it } from 'vitest';
import { pageHref, pageOrigin } from '#/shared/lib/platform/location';

it('names the address the console is served from and the page it is on', () => {
  expect(pageOrigin()).toBe(globalThis.location.origin);
  expect(pageHref()).toBe(globalThis.location.href);
});
