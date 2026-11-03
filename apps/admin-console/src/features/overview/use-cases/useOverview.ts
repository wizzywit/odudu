import type { AuditEvent } from '#/entities/audit-event';
import { hasRelay } from '#/entities/mail-relay';
import { publishedLane, readyToPromote } from '#/entities/signing-key';
import { useAuthority, useRefusal, useTenantMissing } from '#/entities/session';
import { areaAt, areaHref } from '#/entities/area';
import { useArea } from '#/widgets/shell';
import { useOverviewReads } from '#/features/overview/repository/useOverviewReads';
import type { EntityRules } from '#/features/overview/services/entityRules';
import { discoveryView, type DiscoveryView } from '#/features/overview/services/discovery';
import { keysView, type KeysView } from '#/features/overview/services/keys';
import {
  auditView,
  mapOverviewRead,
  overviewAsks,
  readCapability,
  type Gated,
  type OverviewRead,
} from '#/features/overview/services/reads';
import { attentionState, type AttentionState } from '#/features/overview/services/state';
import { countTiles, type AreaOf, type CountTile } from '#/features/overview/services/tiles';

const RULES: EntityRules = { readyToPromote, hasRelay, publishedLane };

export interface Overview {
  discovery: OverviewRead<DiscoveryView>;
  keys: OverviewRead<KeysView>;
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
  const reads = useOverviewReads(
    tenant,
    overviewAsks(authority, missing, areaOf),
    (name, result) => {
      const capability = readCapability(name, areaOf);
      if (capability !== null) refusal.report(result, capability);
    },
  );
  const { retries, ...attention } = attentionState(reads, authority, areaOf, new Date(), RULES);
  return {
    discovery: mapOverviewRead(reads.discovery, discoveryView),
    keys: keysView(reads, authority, areaOf, RULES),
    tiles: countTiles(reads, authority, areaOf),
    attention: {
      ...attention,
      retry: () => {
        for (const again of retries) again();
      },
    },
    audit: auditView(auditAccess, reads.audit, authority, areaOf),
    auditHref: areaHref(tenant, auditArea),
  };
}
