import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, MAX_LIMIT } from '#/admin/shared';

describe('cursorQuerySchema', () => {
  // Pins the schema's upper bound to MAX_LIMIT, the same constant
  // @odudu/protocol-admin's coerceLimit clamps against, so the two
  // cannot silently diverge again.
  it('accepts a limit of MAX_LIMIT and refuses one above it', () => {
    expect(cursorQuerySchema.safeParse({ limit: String(MAX_LIMIT) }).success).toBe(true);
    expect(cursorQuerySchema.safeParse({ limit: String(MAX_LIMIT + 1) }).success).toBe(false);
  });
});
