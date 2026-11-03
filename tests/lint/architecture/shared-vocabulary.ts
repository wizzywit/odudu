// The platform vocabulary that stays in `shared` although it names a domain
// word: each is read by several slices, and an entity imports no entity, so
// no one slice can own it. The list is closed: `no-domain-in-shared` fails
// on an entry that no longer names a domain word, and a new entry is a
// decision against ADR 0048, not a way to quiet the rule.
export const SHARED_VOCABULARY: Readonly<Record<string, string>> = {
  'apps/admin-console/src/shared/services/principal.ts':
    'SYSTEM_TENANT and isTenantName: what every slice reads to tell the system tenant and a tenant name',
  'apps/admin-console/src/shared/services/address.ts':
    'tenantPage: the root every tenant-scoped address is built from',
  'apps/admin-console/src/shared/services/failure.ts':
    'isUnknownTenant: how a failure is worded for the session and the tenants slices alike',
  'apps/admin-console/src/shared/repository/queryKeys.ts':
    'GROUP_KIND and groupKey: the role entity invalidates the group reads, which an entity may not import from the group entity',
  'apps/admin-console/src/shared/services/capabilities/holdings.ts':
    'the capability rules over the roles a principal holds, read by six entities and pages',
  'apps/admin-console/src/shared/services/capabilities/held.ts':
    'the capability rules: who owns a role and what it reaches, worded for every slice that lists roles',
  'apps/admin-console/src/shared/services/capabilities/refusal.ts':
    'the wording of a refused write, shared by the failure service and the subjects pages',
  'apps/admin-console/src/shared/services/capabilities/index.ts':
    'the capability rules barrel, which re-exports the three files above',
};
