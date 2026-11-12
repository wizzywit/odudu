import { describe, expect, it } from 'vitest';
import {
  meConsentsResponseSchema,
  meCredentialsResponseSchema,
  meAmendProfileRequestSchema,
  meListQuerySchema,
  meProfileSchema,
  meRenameCredentialRequestSchema,
  meSessionEndedSchema,
  meSessionsEndedSchema,
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
      recovery_codes_low: false,
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

describe('meAmendProfileRequestSchema', () => {
  it('takes the claims a person writes about themselves', () => {
    const body = {
      name: 'Ada',
      nickname: null,
      address_country: 'NG',
      phone_number: '+2348012345678',
    };
    expect(meAmendProfileRequestSchema.parse(body)).toEqual(body);
  });

  it('takes a username, which the route gates, and an email, which it refuses by name', () => {
    expect(meAmendProfileRequestSchema.parse({ username: 'ada2', email: 'a@b.example' })).toEqual({
      username: 'ada2',
      email: 'a@b.example',
    });
  });

  it.each(['', 'a\u0000b', 4])('refuses the username %j', (username) => {
    expect(meAmendProfileRequestSchema.safeParse({ username }).success).toBe(false);
  });

  it.each(['email_verified', 'phone_number_verified', 'profile_updated_at', 'sub', 'enabled'])(
    'refuses %s, which a person does not set here',
    (member) => {
      expect(meAmendProfileRequestSchema.safeParse({ [member]: 'x' }).success).toBe(false);
    },
  );

  it('refuses a body with no member at all', () => {
    expect(meAmendProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a value that is not a string or null, and a NUL byte', () => {
    expect(meAmendProfileRequestSchema.safeParse({ name: 4 }).success).toBe(false);
    expect(meAmendProfileRequestSchema.safeParse({ name: 'a\u0000b' }).success).toBe(false);
  });
});

describe('meRenameCredentialRequestSchema', () => {
  it('takes a label, trimmed', () => {
    expect(meRenameCredentialRequestSchema.parse({ label: '  Work phone ' })).toEqual({
      label: 'Work phone',
    });
  });

  it.each([{ label: '' }, { label: '   ' }, { label: 'x'.repeat(101) }, { label: null }, {}])(
    'refuses %j',
    (body) => {
      expect(meRenameCredentialRequestSchema.safeParse(body).success).toBe(false);
    },
  );

  it('refuses a bidirectional control and any other member', () => {
    expect(meRenameCredentialRequestSchema.safeParse({ label: 'a\u202Eb' }).success).toBe(false);
    expect(meRenameCredentialRequestSchema.safeParse({ label: 'a', type: 'totp' }).success).toBe(
      false,
    );
  });
});

describe('the session end responses', () => {
  it('say whether the token’s own session ended', () => {
    expect(meSessionEndedSchema.parse({ current_session_ended: true })).toEqual({
      current_session_ended: true,
    });
  });

  it('say how many others ended and whether more remain', () => {
    expect(meSessionsEndedSchema.parse({ ended: 2, more: false })).toEqual({
      ended: 2,
      more: false,
    });
  });
});
