import { describe, expect, it } from 'vitest';
import { needsAttention, type AttentionInputs } from '#/pages/overview/services/attention';
import { SMTP_NONE, QUIET } from '#/testing/overviewFixtures';

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

  it('is registration by token with no room left under the client cap', () => {
    const token = { ...QUIET.settings, client_registration_policy: 'token', max_clients: 3 };
    expect(ids({ settings: token })).toEqual(['registration']);
    expect(ids({ settings: { ...token, max_clients: 4 } })).toEqual([]);
    expect(ids({ settings: { ...token, client_registration_policy: 'disabled' } })).toEqual([]);
  });

  it('is not open registration, which max_clients no longer stops', () => {
    const open = { ...QUIET.settings, client_registration_policy: 'open', max_clients: 3 };
    expect(ids({ settings: open })).toEqual([]);
  });

  it('is room it cannot decide when the count stopped below the cap', () => {
    const token = { ...QUIET.settings, client_registration_policy: 'token', max_clients: 20_000 };
    expect(ids({ settings: token, clients: { count: 10_000, capped: true } })).toEqual([]);
    expect(
      ids({
        settings: { ...token, max_clients: 10_000 },
        clients: { count: 10_000, capped: true },
      }),
    ).toEqual(['registration']);
  });

  it('skips a check whose reads it does not have', () => {
    const on = { ...QUIET.settings, verify_email: true, client_registration_policy: 'open' };
    expect(ids({ settings: on, smtp: undefined, clients: undefined })).toEqual([]);
    expect(ids({ settings: undefined, keys: undefined })).toEqual([]);
  });
});
