import type { SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { publishedLane, readyToPromote } from '#/entities/signing-key';
import type { AttentionInputs } from '#/features/overview/services/attention';
import type { EntityRules } from '#/features/overview/services/entityRules';
import type { OverviewRead, OverviewReads } from '#/features/overview/services/reads';
import type { AreaOf } from '#/features/overview/services/tiles';
import type { AdminCapability, Authority } from '#/shared/services/principal';

export const retry = (): void => undefined;

export const OFF: OverviewRead<never> = { status: 'off' };

export const LOADING: OverviewRead<never> = { status: 'loading' };

export const FAILED: OverviewRead<never> = { status: 'failed', refused: false, retry };

export const REFUSED: OverviewRead<never> = { status: 'failed', refused: true, retry };

export function ready<T>(data: T): OverviewRead<T> {
  return { status: 'ready', data };
}

export function authority(...capabilities: Authority['capabilities'][number][]): Authority {
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
  audit: { label: 'Audit trail', capability: 'view-audit' },
};

export const areaOf: AreaOf = (path) => {
  const found = AREAS[path];
  if (found === undefined) throw new Error(`no area ${path}`);
  return { label: found.label, capability: found.capability, href: `/console/acme/${path}` };
};

export function reads(over: Partial<OverviewReads> = {}): OverviewReads {
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

export const KEYS: readonly SigningKey[] = [
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

export const SMTP_NONE: SmtpConfig = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

export const RULES: EntityRules = { readyToPromote, publishedLane };

export const QUIET: AttentionInputs = {
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
  rules: RULES,
};
