import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library registers its own cleanup only when `afterEach` is a
// global, and this repository's Vitest config does not enable globals.
afterEach(() => {
  cleanup();
});
