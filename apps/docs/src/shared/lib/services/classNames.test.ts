import { describe, expect, it } from 'vitest';
import { classNames } from '@site/src/shared/lib/services/classNames';

describe('classNames', () => {
  it('joins what is present, in order, and skips the rest', () => {
    expect(classNames('a', undefined, 'b', '')).toBe('a b');
    expect(classNames(undefined)).toBe('');
  });
});
