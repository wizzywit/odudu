import type { SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  discoveryView,
  needsAttention,
  publishedKeys,
  type AttentionInputs,
} from '#/features/overview/service.ts';

describe('the discovery document, as the page lays it out', () => {
  const view = discoveryView({
    issuer: 'https://id.example/tenants/acme',
    authorization_endpoint: 'https://id.example/tenants/acme/auth',
    jwks_uri: 'https://id.example/tenants/acme/certs',
    token_endpoint: 'https://id.example/tenants/acme/token',
    grant_types_supported: ['authorization_code', 'refresh_token'],
    claims_parameter_supported: true,
    frontchannel_logout_supported: false,
    scopes_supported: ['openid'],
    service_documentation: 'https://id.example/docs',
  });

  it('keeps the issuer apart', () => {
    expect(view.issuer).toBe('https://id.example/tenants/acme');
  });

  it("lists every endpoint and the JWKS address, in the document's order", () => {
    expect(view.endpoints).toEqual([
      { name: 'authorization_endpoint', url: 'https://id.example/tenants/acme/auth' },
      { name: 'jwks_uri', url: 'https://id.example/tenants/acme/certs' },
      { name: 'token_endpoint', url: 'https://id.example/tenants/acme/token' },
    ]);
  });

  it('lists each _supported member, lists and flags apart', () => {
    expect(view.lists).toEqual([
      { name: 'grant_types_supported', values: ['authorization_code', 'refresh_token'] },
      { name: 'scopes_supported', values: ['openid'] },
    ]);
    expect(view.flags).toEqual([
      { name: 'claims_parameter_supported', value: true },
      { name: 'frontchannel_logout_supported', value: false },
    ]);
  });
});

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
    alg: 'RS256',
    created_at: '2026-09-02T00:00:00Z',
    not_after: null,
  },
];

describe('the published keys', () => {
  const jwks = {
    keys: [
      { kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' },
      { kty: 'RSA', kid: 'kid-r', alg: 'RS256', use: 'sig' },
      { kty: 'RSA', kid: 'kid-x' },
    ],
  };

  it('names each key by its lane, matched on kid', () => {
    expect(publishedKeys(jwks, KEYS)).toEqual([
      { kid: 'kid-a', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'active' },
      { kid: 'kid-r', kty: 'RSA', alg: 'RS256', use: 'sig', lane: 'rotating' },
      { kid: 'kid-x', kty: 'RSA', alg: null, use: null, lane: 'unlisted' },
    ]);
  });

  it('says the lane is unknown when the keys could not be read', () => {
    expect(publishedKeys(jwks, undefined).map((key) => key.lane)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
});

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
