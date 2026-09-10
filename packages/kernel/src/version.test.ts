import { describe, expect, it } from 'vitest';
import { KERNEL_VERSION } from '#/version.js';

describe('KERNEL_VERSION', () => {
  it('is a semver string', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
