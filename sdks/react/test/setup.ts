import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

configure({ asyncUtilTimeout: 5000 });

// The jsdom environment replaces the global typed-array and buffer classes with
// its own, so bytes the platform's crypto and TextEncoder return fail an
// `instanceof` check in the OAuth library. A browser has one set; give the
// tests Node's back, which is what those APIs build on.
Object.assign(globalThis, {
  Uint8Array: Object.getPrototypeOf(Buffer) as typeof Uint8Array,
  ArrayBuffer: Buffer.alloc(0).buffer.constructor as typeof ArrayBuffer,
});

// Testing Library registers its own cleanup only when `afterEach` is a
// global, and this repository's Vitest config does not enable globals.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, '', '/');
});
