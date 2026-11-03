import { describe, expect, it } from 'vitest';
import { useReveal } from '@site/src/features/landing/use-cases/useReveal';
import { resultOf } from '@site/tests/support/hook';

describe('useReveal', () => {
  it('has not taken hold on the server', () => {
    expect(resultOf(useReveal)).toBe(false);
  });
});
