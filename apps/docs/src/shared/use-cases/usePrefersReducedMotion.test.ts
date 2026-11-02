import { describe, expect, it } from 'vitest';
import { usePrefersReducedMotion } from '@site/src/shared/use-cases/usePrefersReducedMotion';
import { resultOf } from '@site/tests/support/hook';

describe('usePrefersReducedMotion', () => {
  it('says no where it cannot know, on the server', () => {
    expect(resultOf(usePrefersReducedMotion)).toBe(false);
  });
});
