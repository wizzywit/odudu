import type { SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { needsAttention, type AttentionInputs } from '#/features/overview/service/attention.ts';

const KEYS: readonly SigningKey[] = [
  {
    id: 'a',
    status: 'active',
    kid: 'kid-a',
    alg: 'ES256',
    created_at: '2026-09-01T00:00:00Z',
    not_after: null,
  },
  {
    id: 'r',
    status: 'rotating',
    kid: 'kid-r',
    alg: 'ES256',
    created_at: '2026-09-02T00:00:00Z',
    not_after: null,
  },
];

const SMTP_NONE: SmtpConfig = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

const QUIET: AttentionInputs = {
  settings: {
    verify_email: false,
    reset_password_allowed: false,
    client_registration_policy: 'disabled',
    max_clients: 200,
  },
  smtp: SMTP_NONE,
  keys: KEYS,
  clients: { count: 3, capped: false },
  // Half an hour after the rotating key was staged.
  now: new Date('2026-09-02T00:30:00Z'),
};

function ids(inputs: Partial<AttentionInputs>): readonly string[] {
  return needsAttention({ ...QUIET, ...inputs }).map((item) => item.id);
}

describe('what needs attention', () => {
  it('is nothing on a quiet tenant', () => {
    expect(ids({})).toEqual([]);
  });

  it('is mail when verification or reset is on and no relay will send it', () => {
    const on = { ...QUIET.settings, verify_email: true };
    expect(ids({ settings: on })).toEqual(['smtp']);
    expect(ids({ settings: { ...QUIET.settings, reset_password_allowed: true } })).toEqual([
      'smtp',
    ]);
    expect(ids({ settings: on, smtp: { ...SMTP_NONE, effective: 'deployment' } })).toEqual([]);
    expect(ids({ settings: on, smtp: { ...SMTP_NONE, effective: 'tenant' } })).toEqual([]);
  });

  it('names what the mail item is for', () => {
    const [item] = needsAttention({
      ...QUIET,
      settings: { ...QUIET.settings, verify_email: true, reset_password_allowed: true },
    });
    expect(item).toMatchObject({ area: 'email', title: 'No mail relay' });
    expect(item?.detail).toContain('email verification and password reset');
  });

  it('is a rotating key once it is ready to promote', () => {
    const later = needsAttention({ ...QUIET, now: new Date('2026-09-02T01:05:01Z') });
    expect(later.map((i) => i.id)).toEqual(['key:r']);
    expect(later[0]).toMatchObject({ area: 'keys', title: 'A signing key is ready to promote' });
    expect(later[0]?.detail).toContain('kid-r');
  });

  it('is open registration with no room left under the client cap', () => {
    const open = { ...QUIET.settings, client_registration_policy: 'open', max_clients: 3 };
    expect(ids({ settings: open })).toEqual(['registration']);
    expect(ids({ settings: { ...open, client_registration_policy: 'token' } })).toEqual([
      'registration',
    ]);
    expect(ids({ settings: { ...open, max_clients: 4 } })).toEqual([]);
    expect(ids({ settings: { ...open, client_registration_policy: 'disabled' } })).toEqual([]);
  });

  it('is room it cannot decide when the count stopped below the cap', () => {
    const open = { ...QUIET.settings, client_registration_policy: 'open', max_clients: 20_000 };
    expect(ids({ settings: open, clients: { count: 10_000, capped: true } })).toEqual([]);
    expect(
      ids({ settings: { ...open, max_clients: 10_000 }, clients: { count: 10_000, capped: true } }),
    ).toEqual(['registration']);
  });

  it('skips a check whose reads it does not have', () => {
    const on = { ...QUIET.settings, verify_email: true, client_registration_policy: 'open' };
    expect(ids({ settings: on, smtp: undefined, clients: undefined })).toEqual([]);
    expect(ids({ settings: undefined, keys: undefined })).toEqual([]);
  });
});
