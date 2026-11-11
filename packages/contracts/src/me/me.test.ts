import { describe, expect, it } from 'vitest';
import {
  meConsentsResponseSchema,
  meCredentialsResponseSchema,
  meListQuerySchema,
  meProfileSchema,
  meSessionsResponseSchema,
} from '#/me/index';

describe('meListQuerySchema', () => {
  it('reads a limit and a cursor', () => {
    expect(meListQuerySchema.parse({ limit: '25', cursor: 'abc' })).toEqual({
      limit: 25,
      cursor: 'abc',
    });
  });

  it('refuses a member it does not name, a subject among them', () => {
    expect(meListQuerySchema.safeParse({ subject: 'x' }).success).toBe(false);
  });

  it('refuses a limit below one', () => {
    expect(meListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('the list responses', () => {
  it('carry a null cursor on the last page', () => {
    expect(meConsentsResponseSchema.parse({ items: [], next_cursor: null })).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it('give a credential no member that could hold a secret', () => {
    const parsed = meCredentialsResponseSchema.parse({
      items: [
        {
          id: 'c1',
          type: 'totp',
          label: null,
          created_at: '2026-01-01T00:00:00.000Z',
          last_used_at: null,
          secret_data: 'leak',
        },
      ],
      next_cursor: null,
      recovery_codes_left: 3,
    });
    expect(parsed.items[0]).not.toHaveProperty('secret_data');
  });

  it('say a session has no device yet', () => {
    const parsed = meSessionsResponseSchema.parse({
      items: [
        {
          id: 's1',
          created_at: '2026-01-01T00:00:00.000Z',
          last_active_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-02T00:00:00.000Z',
          remembered: false,
          current: true,
          device: null,
        },
      ],
      next_cursor: null,
    });
    expect(parsed.items[0]?.device).toBeNull();
  });
});

describe('meProfileSchema', () => {
  it('names the subject and carries the profile claims', () => {
    const shape = Object.keys(meProfileSchema.shape);
    expect(shape).toEqual(expect.arrayContaining(['sub', 'username', 'email', 'name', 'locale']));
  });
});
