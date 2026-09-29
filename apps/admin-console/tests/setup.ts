import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout, so the router's scroll restoration has nothing to scroll.
window.scrollTo = () => undefined;
// jsdom has no canvas; axe asks for one to measure contrast, which Playwright checks instead.
HTMLCanvasElement.prototype.getContext = () => null;

// The default 1 s for a find* query is too tight for a runner that is
// testing several packages at once: a file's first find waits on a lazy
// feature route, whose whole module graph is transformed then.
configure({ asyncUtilTimeout: 15_000 });

// Testing Library registers its own cleanup only when `afterEach` is a
// global, and this repository's Vitest config does not enable globals.
afterEach(() => {
  cleanup();
});
