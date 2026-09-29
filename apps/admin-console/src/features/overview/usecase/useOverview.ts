import type { AuditEvent, SigningKey } from '@odudu/contracts/admin';
import { useAuthority, useRefusal, useTenantMissing } from '#/features/session/index.ts';
import { areaAt, areaHref, holds, useArea } from '#/features/shell/index.ts';
import {
  useOverviewReads,
  type OverviewReads,
  type ReadName,
} from '#/features/overview/repository/useOverviewReads.ts';
import {
  discoveryView,
  needsAttention,
  publishedKeys,
  rawJson,
  type AttentionState,
  type CountTile,
  type DiscoveryView,
  type Gated,
  type KeysView,
  type Read,
} from '#/features/overview/service.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';

export interface Overview {
  readonly discovery: Read<DiscoveryView>;
  readonly keys: Read<KeysView>;
  readonly tiles: readonly CountTile[];
  readonly attention: AttentionState;
  readonly audit: Gated<readonly AuditEvent[]>;
  readonly auditHref: string;
}

const COUNTED = [
  { id: 'subjects', noun: { one: 'subject', other: 'subjects' } },
  { id: 'clients', noun: { one: 'client', other: 'clients' } },
  { id: 'groups', noun: { one: 'group', other: 'groups' } },
  { id: 'roles', noun: { one: 'role', other: 'roles' } },
  { id: 'scopes', noun: { one: 'scope', other: 'scopes' } },
] as const;

function mapRead<T, U>(read: Read<T>, map: (data: T) => U): Read<U> {
  return read.status === 'ready' ? { status: 'ready', data: map(read.data) } : read;
}

function readyData<T>(read: Read<T>): T | undefined {
  return read.status === 'ready' ? read.data : undefined;
}

// Before whoami answers a read is `off` and shows as loading; after, one
// whose capability is not held, or that the server refused, names it.
function gate<T>(
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

function keysView(reads: OverviewReads, authority: Authority | undefined): Read<KeysView> {
  const keys = gate(reads.keys, authority, 'manage-keys');
  const listed: readonly SigningKey[] | undefined = keys.status === 'ready' ? keys.data : undefined;
  return mapRead(reads.jwks, (jwks) => ({
    rows: publishedKeys(jwks, listed),
    raw: rawJson(jwks),
    lanesNeed: keys.status === 'needs' ? keys.capability : null,
  }));
}

// The attention checks read settings and the SMTP relay, the signing keys,
// and the client count.
const CHECKED_WITH: readonly AdminCapability[] = ['manage-tenant', 'manage-keys', 'manage-clients'];

function attentionState(
  tenant: string,
  reads: OverviewReads,
  authority: Authority | undefined,
): AttentionState {
  const used = [reads.settings, reads.smtp, reads.keys, reads.counts.clients];
  const unchecked = authority === undefined ? [] : CHECKED_WITH.filter((c) => !holds(authority, c));
  const failed = used.filter((read) => read.status === 'failed');
  const items = needsAttention({
    settings: readyData(reads.settings),
    smtp: readyData(reads.smtp),
    keys: readyData(reads.keys),
    clients: readyData(reads.counts.clients),
    now: new Date(),
  }).map((item) => {
    const area = areaAt(item.area);
    return { ...item, href: areaHref(tenant, area), place: area.label };
  });
  return {
    status:
      authority === undefined || used.some((read) => read.status === 'loading')
        ? 'checking'
        : 'ready',
    items,
    unchecked,
    failed: failed.length > 0,
    retry: () => {
      for (const read of failed) read.retry();
    },
  };
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

export function useOverview(tenant: string): Overview {
  const authority = useAuthority(tenant);
  const missing = useTenantMissing(tenant);
  const auditArea = areaAt('audit');
  const auditAccess = useArea(tenant, auditArea);
  const refusal = useRefusal(tenant);
  const has = (name: ReadName) => {
    const capability = NEEDS[name];
    return authority !== undefined && capability !== null && holds(authority, capability);
  };
  const reads = useOverviewReads(
    tenant,
    {
      discovery: missing === false,
      subjects: has('subjects'),
      clients: has('clients'),
      groups: has('groups'),
      roles: has('roles'),
      scopes: has('scopes'),
      settings: has('settings'),
      smtp: has('smtp'),
      keys: has('keys'),
      audit: has('audit'),
    },
    (name, result) => {
      const capability = NEEDS[name];
      if (capability !== null) refusal.report(result, capability);
    },
  );
  const settings = readyData(reads.settings);
  const cap = settings?.max_clients;
  const tiles = COUNTED.map(({ id, noun }): CountTile => {
    const area = areaAt(id);
    return {
      id,
      label: area.label,
      href: areaHref(tenant, area),
      noun,
      count: gate(reads.counts[id], authority, area.capability),
      limit: id === 'clients' && typeof cap === 'number' ? cap : undefined,
    };
  });
  return {
    discovery: mapRead(reads.discovery, discoveryView),
    keys: keysView(reads, authority),
    tiles,
    attention: attentionState(tenant, reads, authority),
    audit:
      auditAccess.kind === 'refused'
        ? { status: 'needs', capability: auditAccess.capability }
        : gate(reads.audit, authority, 'view-audit'),
    auditHref: areaHref(tenant, auditArea),
  };
}
