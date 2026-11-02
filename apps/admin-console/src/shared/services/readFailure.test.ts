import { expect, it } from 'vitest';
import { ReadFailure, readFailureOf } from '#/shared/services/readFailure';

const NETWORK = { ok: false as const, kind: 'network' as const };

it('carries the failure of a read, and gives it back from the error', () => {
  expect(readFailureOf(new ReadFailure(NETWORK))).toBe(NETWORK);
});

it('knows no failure in an error that is not one of a read', () => {
  expect(readFailureOf(new Error('boom'))).toBeNull();
  expect(readFailureOf({ failure: NETWORK })).toBeNull();
  expect(readFailureOf(null)).toBeNull();
  expect(readFailureOf(undefined)).toBeNull();
});
