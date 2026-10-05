import type {
  AuditEvent,
  CountResponse,
  Settings,
  SigningKey,
  SmtpConfig,
} from '@odudu/contracts/admin';
import { holds } from '#/shared/service/access.ts';
import { isRefused } from '#/shared/service/failure.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/service/result.ts';
import { type Discovery, type Jwks } from '#/features/overview/service/discovery.ts';

// One of the page's reads: `off` is one it did not make, because whoami has
// not answered or says the capability it needs is not held.
export type Read<T> =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; refused: boolean; retry: () => void };

// A read the page may not make at all, because whoami says the capability
// it needs is not held.
export type Gated<T> = Read<T> | { status: 'needs'; capability: string };

export type Collection = 'subjects' | 'clients' | 'groups' | 'roles' | 'scopes';

export interface OverviewAsks {
  discovery: boolean;
  subjects: boolean;
  clients: boolean;
  groups: boolean;
  roles: boolean;
  scopes: boolean;
  settings: boolean;
  smtp: boolean;
  keys: boolean;
  audit: boolean;
}

export type ReadName = keyof OverviewAsks | 'jwks';

export interface OverviewReads {
  discovery: Read<Discovery>;
  jwks: Read<Jwks>;
  counts: Readonly<Record<Collection, Read<CountResponse>>>;
  settings: Read<Settings>;
  smtp: Read<SmtpConfig>;
  keys: Read<readonly SigningKey[]>;
  audit: Read<readonly AuditEvent[]>;
}

export function readOutcome<T>(
  asked: boolean,
  result: GatewayResult<T> | undefined,
  retry: () => void,
): Read<T> {
  if (!asked) return { status: 'off' };
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return { status: 'failed', refused: isRefused(result), retry };
}

export function mapRead<T, U>(read: Read<T>, map: (data: T) => U): Read<U> {
  return read.status === 'ready' ? { status: 'ready', data: map(read.data) } : read;
}

export function readyData<T>(read: Read<T>): T | undefined {
  return read.status === 'ready' ? read.data : undefined;
}

// Before whoami answers a read is `off` and shows as loading; after, one
// whose capability is not held, or that the server refused, names it.
export function gate<T>(
  read: Read<T>,
  authority: Authority | undefined,
  capability: AdminCapability | null,
): Gated<T> {
  if (capability === null) return read;
  const refused = read.status === 'failed' && read.refused;
  if ((authority !== undefined && !holds(authority, capability)) || refused) {
    return { status: 'needs', capability };
  }
  return read;
}

// What each read needs; the tenant's public documents need no capability.
const NEEDS: Readonly<Record<ReadName, AdminCapability | null>> = {
  discovery: null,
  jwks: null,
  subjects: 'view-users',
  clients: 'manage-clients',
  groups: 'manage-tenant',
  roles: 'manage-tenant',
  scopes: 'manage-tenant',
  settings: 'manage-tenant',
  smtp: 'manage-tenant',
  keys: 'manage-keys',
  audit: 'view-audit',
};

export function readCapability(name: ReadName): AdminCapability | null {
  return NEEDS[name];
}

// A read the capability allows, once whoami has said what is held; the
// public documents are asked for as soon as the tenant is known to exist.
export function overviewAsks(
  authority: Authority | undefined,
  tenantMissing: boolean | undefined,
): OverviewAsks {
  const has = (name: ReadName): boolean => {
    const capability = NEEDS[name];
    return authority !== undefined && capability !== null && holds(authority, capability);
  };
  return {
    discovery: tenantMissing === false,
    subjects: has('subjects'),
    clients: has('clients'),
    groups: has('groups'),
    roles: has('roles'),
    scopes: has('scopes'),
    settings: has('settings'),
    smtp: has('smtp'),
    keys: has('keys'),
    audit: has('audit'),
  };
}

// The latest audit rows are left off the page when the area is not the
// caller's to read.
export function auditView(
  access: { kind: 'hidden' | 'checking' | 'refused' | 'open' },
  audit: Read<readonly AuditEvent[]>,
  authority: Authority | undefined,
): Gated<readonly AuditEvent[]> | null {
  return access.kind === 'refused' ? null : gate(audit, authority, 'view-audit');
}
