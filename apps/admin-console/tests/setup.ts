import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout, so the router's scroll restoration has nothing to scroll.
window.scrollTo = () => undefined;
// jsdom has no canvas; axe asks for one to measure contrast, which Playwright checks instead.
HTMLCanvasElement.prototype.getContext = () => null;

// Testing Library registers its own cleanup only when `afterEach` is a
// global, and this repository's Vitest config does not enable globals.
afterEach(() => {
  cleanup();
});
