import { describe, expect, it } from 'vitest';
import {
  cursorQuerySchema,
  listLimitMessage,
  listLimitProblem,
  MAX_LIMIT,
  problemDetailsSchema,
} from '#/admin/shared';

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

describe('problemDetailsSchema', () => {
  it('carries the fields a refusal names beside its prose', () => {
    const body = {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      instance: 'req-1',
      detail: 'port: must be <= 65535',
      errors: [{ path: 'port', message: 'must be <= 65535' }],
    };
    expect(problemDetailsSchema.parse(body)).toEqual(body);
  });

  it('refuses a field error with anything beside its path and message', () => {
    const errors = [{ path: 'port', message: 'too big', code: 'x' }];
    const body = { type: 'about:blank', title: 'Bad Request', status: 400, instance: 'r', errors };
    expect(problemDetailsSchema.safeParse(body).success).toBe(false);
  });
});

describe('the sentence a bounded client list is refused with', () => {
  it('says how many it holds and how many it may, with and without its field', () => {
    expect(listLimitMessage(201)).toBe('holds 201 entries, at most 200');
    expect(listLimitProblem('web_origins', 201)).toBe('web_origins holds 201 entries, at most 200');
  });
});
