import '#/testing/renderCounter.ts';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout, so the router's scroll restoration has nothing to scroll.
window.scrollTo = () => undefined;
// jsdom has no canvas; axe asks for one to measure contrast, which Playwright checks instead.
HTMLCanvasElement.prototype.getContext = () => null;

// The default 1 s for a find* query is too tight for a runner that is
// testing several packages at once.
configure({ asyncUtilTimeout: 5000 });

// Testing Library registers its own cleanup only when `afterEach` is a
// global, and this repository's Vitest config does not enable globals.
afterEach(() => {
  cleanup();
});
