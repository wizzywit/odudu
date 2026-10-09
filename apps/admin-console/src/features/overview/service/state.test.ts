import type { Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { attentionState, isClear } from '#/features/overview/service/state.ts';
import { type AttentionInputs } from '#/features/overview/service/attention.ts';
import { type AreaOf } from '#/features/overview/service/tiles.ts';
import { type OverviewReads, type Read } from '#/features/overview/service/reads.ts';

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

const OFF: Read<never> = { status: 'off' };

const LOADING: Read<never> = { status: 'loading' };

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
