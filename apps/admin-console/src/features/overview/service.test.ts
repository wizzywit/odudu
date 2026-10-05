import type { Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  attentionState,
  auditView,
  countAgainLabel,
  countTiles,
  discoveryView,
  gate,
  isClear,
  keysView,
  laneText,
  limitText,
  needsAttention,
  openPlaceLabel,
  overviewAsks,
  publishedKeys,
  rawJson,
  readCapability,
  readOutcome,
  UNCHECKED_LEAD,
  unreadableTitle,
  type AttentionInputs,
  type AreaOf,
  type OverviewReads,
  type Read,
} from '#/features/overview/service.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/service/result.ts';

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

  it('keeps the issuer apart, with the address of the document it publishes', () => {
    expect(view.issuer).toBe('https://id.example/tenants/acme');
    expect(view.document).toBe('https://id.example/tenants/acme/.well-known/openid-configuration');
  });

  it('keeps the whole document, laid out, for the raw view', () => {
    expect(view.raw).toContain('\n  "service_documentation": "https://id.example/docs"');
    expect(JSON.parse(view.raw)).toMatchObject({ scopes_supported: ['openid'] });
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
    alg: 'ES256',
    created_at: '2026-09-02T00:00:00Z',
    not_after: null,
  },
];

describe('the published keys', () => {
  const jwks = {
    keys: [
      { kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' },
      { kty: 'EC', kid: 'kid-r', alg: 'ES256', use: 'sig' },
      { kty: 'RSA', kid: 'kid-x' },
    ],
  };

  it('names each key by its lane, matched on kid', () => {
    expect(publishedKeys(jwks, KEYS)).toEqual([
      { row: '0', kid: 'kid-a', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'active' },
      { row: '1', kid: 'kid-r', kty: 'EC', alg: 'ES256', use: 'sig', lane: 'rotating' },
      { row: '2', kid: 'kid-x', kty: 'RSA', alg: null, use: null, lane: 'unlisted' },
    ]);
  });

  it('tells apart two keys that carry no kid', () => {
    const rows = publishedKeys({ keys: [{ kty: 'RSA' }, { kty: 'RSA' }] }, undefined);
    expect(new Set(rows.map((key) => key.row)).size).toBe(2);
  });

  it('keeps the whole set, laid out, for the raw view', () => {
    expect(rawJson(jwks)).toBe(JSON.stringify(jwks, null, 2));
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

const retry = (): void => undefined;
const OFF: Read<never> = { status: 'off' };
const LOADING: Read<never> = { status: 'loading' };
const FAILED: Read<never> = { status: 'failed', refused: false, retry };
const REFUSED: Read<never> = { status: 'failed', refused: true, retry };

function ready<T>(data: T): Read<T> {
  return { status: 'ready', data };
}

function authority(...capabilities: Authority['capabilities'][number][]): Authority {
  return { capabilities, crossTenant: false };
}

const AREAS: Readonly<Record<string, { label: string; capability: AdminCapability | null }>> = {
  subjects: { label: 'Subjects', capability: 'view-users' },
  clients: { label: 'Clients', capability: 'manage-clients' },
  groups: { label: 'Groups', capability: 'manage-tenant' },
  roles: { label: 'Roles', capability: 'manage-tenant' },
  scopes: { label: 'Scopes', capability: 'manage-tenant' },
  email: { label: 'Email', capability: 'manage-tenant' },
  keys: { label: 'Signing keys', capability: 'manage-keys' },
  settings: { label: 'Settings', capability: 'manage-tenant' },
};

const areaOf: AreaOf = (path) => {
  const found = AREAS[path];
  if (found === undefined) throw new Error(`no area ${path}`);
  return { label: found.label, capability: found.capability, href: `/console/acme/${path}` };
};

function reads(over: Partial<OverviewReads> = {}): OverviewReads {
  return {
    discovery: OFF,
    jwks: OFF,
    counts: { subjects: OFF, clients: OFF, groups: OFF, roles: OFF, scopes: OFF },
    settings: OFF,
    smtp: OFF,
    keys: OFF,
    audit: OFF,
    ...over,
  };
}

describe('a read gated by a capability', () => {
  const read = ready(1);

  it('is the read itself when it needs none', () => {
    expect(gate(read, undefined, null)).toBe(read);
  });

  it('is the read while whoami has not answered', () => {
    expect(gate(read, undefined, 'view-audit')).toBe(read);
    expect(gate(LOADING, undefined, 'view-audit')).toBe(LOADING);
  });

  it('names the capability when whoami says it is not held', () => {
    expect(gate(read, authority('view-users'), 'view-audit')).toEqual({
      status: 'needs',
      capability: 'view-audit',
    });
  });

  it('names it too when the server refused the read', () => {
    expect(gate(REFUSED, authority('view-audit'), 'view-audit')).toEqual({
      status: 'needs',
      capability: 'view-audit',
    });
    expect(gate(FAILED, authority('view-audit'), 'view-audit')).toBe(FAILED);
  });
});

describe('a read as a gateway answer reads', () => {
  const answered = (data: number): GatewayResult<number> => ({
    ok: true,
    status: 200,
    data,
    etag: null,
    next: null,
  });

  it('is off when it was not asked, however it was answered', () => {
    expect(readOutcome(false, answered(1), retry)).toEqual({ status: 'off' });
  });

  it('is loading until it answers', () => {
    expect(readOutcome(true, undefined, retry)).toEqual({ status: 'loading' });
  });

  it('is ready with the data', () => {
    expect(readOutcome(true, answered(7), retry)).toEqual({ status: 'ready', data: 7 });
  });

  it('is failed, refused only for a 403, with the way to ask again', () => {
    const problem = (status: number): GatewayResult<number> => ({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Problem', status },
    });
    expect(readOutcome(true, problem(403), retry)).toEqual({
      status: 'failed',
      refused: true,
      retry,
    });
    expect(readOutcome(true, problem(500), retry)).toMatchObject({ refused: false });
    expect(readOutcome(true, { ok: false, kind: 'network' }, retry)).toMatchObject({
      status: 'failed',
      refused: false,
    });
  });
});

describe('which reads the overview asks for', () => {
  it('asks for nothing until whoami has answered, and for the public documents once the tenant is known', () => {
    expect(overviewAsks(undefined, undefined)).toEqual({
      discovery: false,
      subjects: false,
      clients: false,
      groups: false,
      roles: false,
      scopes: false,
      settings: false,
      smtp: false,
      keys: false,
      audit: false,
    });
    expect(overviewAsks(undefined, false).discovery).toBe(true);
    expect(overviewAsks(undefined, true).discovery).toBe(false);
  });

  it('asks for what the held capabilities read', () => {
    expect(overviewAsks(authority('view-users', 'manage-keys'), false)).toMatchObject({
      subjects: true,
      keys: true,
      clients: false,
      settings: false,
      audit: false,
    });
    expect(
      overviewAsks(authority('manage-tenant', 'view-audit', 'manage-clients'), false),
    ).toMatchObject({
      groups: true,
      roles: true,
      scopes: true,
      settings: true,
      smtp: true,
      audit: true,
      clients: true,
      subjects: false,
    });
  });

  it('names the capability a read needs, none for the public documents', () => {
    expect(readCapability('discovery')).toBeNull();
    expect(readCapability('jwks')).toBeNull();
    expect(readCapability('audit')).toBe('view-audit');
    expect(readCapability('smtp')).toBe('manage-tenant');
  });
});

describe('the published keys the overview lays out', () => {
  const jwks = ready({ keys: [{ kty: 'EC', kid: 'kid-a', alg: 'ES256', use: 'sig' }] });

  it('carries each key in its lane when the key list was read', () => {
    const view = keysView(reads({ jwks, keys: ready(KEYS) }), authority('manage-keys'));
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: null, rows: [{ kid: 'kid-a', lane: 'active' }] },
    });
  });

  it('leaves the lane unknown and names the capability when the list is not held', () => {
    const view = keysView(reads({ jwks, keys: ready(KEYS) }), authority('view-users'));
    expect(view).toMatchObject({
      status: 'ready',
      data: { lanesNeed: 'manage-keys', rows: [{ lane: 'unknown' }] },
    });
  });

  it('is the JWKS read itself while it has not answered', () => {
    expect(keysView(reads({ jwks: LOADING }), undefined)).toEqual({ status: 'loading' });
  });
});

describe('the count tiles', () => {
  const asked = reads({
    counts: {
      subjects: ready({ count: 3, capped: false }),
      clients: ready({ count: 2, capped: false }),
      groups: LOADING,
      roles: OFF,
      scopes: OFF,
    },
    settings: ready<Settings>({ max_clients: 200 }),
  });

  it('leaves out the tile of an area the caller cannot read', () => {
    const tiles = countTiles(asked, authority('view-users'), areaOf);
    expect(tiles.map((t) => t.id)).toEqual(['subjects']);
  });

  it('lists every tile until whoami has answered, in the rail order', () => {
    expect(countTiles(asked, undefined, areaOf).map((t) => t.id)).toEqual([
      'subjects',
      'clients',
      'groups',
      'roles',
      'scopes',
    ]);
  });

  it('carries the area label and address, and the noun the count is said in', () => {
    const [tile] = countTiles(asked, undefined, areaOf);
    expect(tile).toMatchObject({
      id: 'subjects',
      label: 'Subjects',
      href: '/console/acme/subjects',
      noun: { one: 'subject', other: 'subjects' },
      count: { status: 'ready' },
    });
  });

  it('puts the client cap on the clients tile alone, when settings gave a number', () => {
    const tiles = countTiles(asked, undefined, areaOf);
    expect(tiles.map((t) => t.limit)).toEqual([undefined, 200, undefined, undefined, undefined]);
    const none = countTiles(
      reads({ settings: ready<Settings>({ max_clients: null }) }),
      undefined,
      areaOf,
    );
    expect(none.every((t) => t.limit === undefined)).toBe(true);
  });

  it('gates a count the caller does not hold', () => {
    const [tile] = countTiles(asked, authority('manage-keys'), areaOf);
    expect(tile).toBeUndefined();
    const all = countTiles(
      reads({ counts: { ...asked.counts, groups: REFUSED } }),
      authority('manage-tenant'),
      areaOf,
    );
    expect(all.map((t) => t.count.status)).toEqual(['needs', 'off', 'off']);
  });
});

describe('the attention state', () => {
  const NOW = new Date('2026-09-02T00:30:00Z');
  const everything = authority('manage-tenant', 'manage-keys', 'manage-clients');
  const settled = reads({
    settings: ready<Settings>({ ...QUIET.settings }),
    smtp: ready(SMTP_NONE),
    keys: ready(KEYS),
    counts: {
      subjects: OFF,
      clients: ready({ count: 3, capped: false }),
      groups: OFF,
      roles: OFF,
      scopes: OFF,
    },
  });

  it('is checking until whoami answers or a read it uses is loading', () => {
    expect(attentionState(settled, undefined, areaOf, NOW).status).toBe('checking');
    const loading = reads({ ...settled, smtp: LOADING });
    expect(attentionState(loading, everything, areaOf, NOW).status).toBe('checking');
    expect(attentionState(settled, everything, areaOf, NOW).status).toBe('ready');
  });

  it('links each item to the area that fixes it', () => {
    const noMail = reads({
      ...settled,
      settings: ready<Settings>({ ...QUIET.settings, verify_email: true }),
    });
    const state = attentionState(noMail, everything, areaOf, NOW);
    expect(state.items).toEqual([
      expect.objectContaining({
        id: 'smtp',
        href: '/console/acme/email',
        place: 'Email',
      }),
    ]);
  });

  it('judges promotion by the clock it is given', () => {
    const early = attentionState(settled, everything, areaOf, NOW);
    const later = attentionState(settled, everything, areaOf, new Date('2026-09-02T01:05:01Z'));
    expect(early.items).toEqual([]);
    expect(later.items.map((i) => i.id)).toEqual(['key:r']);
  });

  it('names the capabilities a check needed that whoami says are missing', () => {
    expect(attentionState(settled, authority('manage-tenant'), areaOf, NOW).unchecked).toEqual([
      'manage-keys',
      'manage-clients',
    ]);
    expect(attentionState(settled, undefined, areaOf, NOW).unchecked).toEqual([]);
  });

  it('hands back the way to ask again for each failed read it uses', () => {
    const calls: string[] = [];
    const failing = reads({
      ...settled,
      smtp: { status: 'failed', refused: false, retry: () => calls.push('smtp') },
      keys: { status: 'failed', refused: true, retry: () => calls.push('keys') },
      audit: { status: 'failed', refused: false, retry: () => calls.push('audit') },
    });
    const state = attentionState(failing, everything, areaOf, NOW);
    expect(state.failed).toBe(true);
    for (const again of state.retries) again();
    expect(calls).toEqual(['smtp', 'keys']);
    expect(attentionState(settled, everything, areaOf, NOW)).toMatchObject({
      failed: false,
      retries: [],
    });
  });

  it('is clear only when it is ready with nothing to say, to check or to retry', () => {
    const state = attentionState(settled, everything, areaOf, NOW);
    expect(isClear(state)).toBe(true);
    expect(isClear({ ...state, status: 'checking' })).toBe(false);
    expect(isClear({ ...state, failed: true })).toBe(false);
    expect(isClear({ ...state, unchecked: ['manage-keys'] })).toBe(false);
    expect(
      isClear({
        ...state,
        items: [{ id: 'x', area: 'keys', title: '', detail: '', href: '', place: '' }],
      }),
    ).toBe(false);
  });
});

describe('the latest activity', () => {
  const events = ready([]);

  it('is left off the page when the audit trail is not the caller to read', () => {
    expect(auditView({ kind: 'refused' }, events, authority())).toBeNull();
  });

  it('is gated by view-audit otherwise', () => {
    expect(auditView({ kind: 'open' }, events, authority('view-audit'))).toBe(events);
    expect(auditView({ kind: 'checking' }, events, undefined)).toBe(events);
  });
});

describe('the words of the overview panels', () => {
  it('says the lane of a published key', () => {
    expect(laneText('unlisted')).toBe('not in the key list');
    expect(laneText('active')).toBe('active');
    expect(laneText('rotating')).toBe('rotating');
  });

  it('says what a failed read could not do', () => {
    expect(unreadableTitle('JWKS')).toBe('The JWKS could not be read');
  });

  it('says the allowance beside a count, with thousands grouped', () => {
    expect(limitText(200)).toBe(' of 200 allowed');
    expect(limitText(12_000)).toBe(' of 12,000 allowed');
  });

  it('labels the button that counts again', () => {
    expect(countAgainLabel('clients')).toBe('Count clients again');
  });
});

describe('the words of the attention panel', () => {
  it('names the area a link opens', () => {
    expect(openPlaceLabel('Email')).toBe('Open Email');
  });

  it('leads the capabilities the checks needed', () => {
    expect(UNCHECKED_LEAD).toBe('Some checks need a capability you do not hold: ');
  });
});
