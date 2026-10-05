import type { AuditEvent } from '@odudu/contracts/admin';
import { useAuthority, useRefusal, useTenantMissing } from '#/features/session';
import { areaAt, areaHref, useArea } from '#/features/shell';
import { useOverviewReads } from '#/features/overview/repository/useOverviewReads.ts';
import {
  attentionState,
  auditView,
  countTiles,
  discoveryView,
  keysView,
  mapRead,
  overviewAsks,
  readCapability,
  type AreaOf,
  type AttentionState,
  type CountTile,
  type DiscoveryView,
  type Gated,
  type KeysView,
  type Read,
} from '#/features/overview/service.ts';

export interface Overview {
  discovery: Read<DiscoveryView>;
  keys: Read<KeysView>;
  tiles: readonly CountTile[];
  attention: AttentionState;
  // Null when whoami says the audit trail is not the operator's to read.
  audit: Gated<readonly AuditEvent[]> | null;
  auditHref: string;
}

export function useOverview(tenant: string): Overview {
  const authority = useAuthority(tenant);
  const missing = useTenantMissing(tenant);
  const auditArea = areaAt('audit');
  const auditAccess = useArea(tenant, auditArea);
  const refusal = useRefusal(tenant);
  const areaOf: AreaOf = (path) => {
    const area = areaAt(path);
    return { label: area.label, capability: area.capability, href: areaHref(tenant, area) };
  };
  const reads = useOverviewReads(tenant, overviewAsks(authority, missing), (name, result) => {
    const capability = readCapability(name);
    if (capability !== null) refusal.report(result, capability);
  });
  const { retries, ...attention } = attentionState(reads, authority, areaOf, new Date());
  return {
    discovery: mapRead(reads.discovery, discoveryView),
    keys: keysView(reads, authority),
    tiles: countTiles(reads, authority, areaOf),
    attention: {
      ...attention,
      retry: () => {
        for (const again of retries) again();
      },
    },
    audit: auditView(auditAccess, reads.audit, authority),
    auditHref: areaHref(tenant, auditArea),
  };
}
