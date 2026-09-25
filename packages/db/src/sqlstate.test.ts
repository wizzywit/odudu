import { describe, expect, it } from 'vitest';
import { isCheckViolation, isUniqueViolation } from '#/sqlstate';

describe('reading a SQLSTATE off a wrapped driver error', () => {
  it('finds one the driver reports directly', () => {
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(true);
    expect(isCheckViolation(Object.assign(new Error('x'), { code: '23514' }))).toBe(true);
  });

  // The walk must not stop at the first `code` it meets: Drizzle wraps
  // postgres.js, and a wrapper carrying a code of its own would otherwise
  // mask the violation underneath and turn an answerable 400 into a 500.
  it('finds one nested under a wrapper that carries its own code', () => {
    const wrapped = Object.assign(new Error('wrapper'), {
      code: 'DRIZZLE_QUERY_FAILED',
      cause: Object.assign(new Error('inner'), { code: '23514' }),
    });

    expect(isCheckViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped)).toBe(false);
  });

  it('answers false for what is not an error object at all', () => {
    expect(isCheckViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
