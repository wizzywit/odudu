import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, MAX_LIMIT } from '#/admin/shared';

describe('cursorQuerySchema', () => {
  // A shape check only: MAX_LIMIT is a page-size ceiling to coerce down to
  // (@odudu/protocol-admin's coerceLimit), never a reason to refuse the
  // request — the HTTP-level pin is
  // packages/protocol-admin/tests/tenants.int.test.ts's clamping test.
  it('accepts a positive integer above MAX_LIMIT', () => {
    expect(cursorQuerySchema.safeParse({ limit: String(MAX_LIMIT + 1) }).success).toBe(true);
    expect(cursorQuerySchema.safeParse({ limit: '1000000' }).success).toBe(true);
  });

  it('refuses a limit that is not a positive integer', () => {
    for (const raw of ['0', '-1', '1.5', 'abc', '']) {
      expect(cursorQuerySchema.safeParse({ limit: raw }).success, raw).toBe(false);
    }
  });
});
