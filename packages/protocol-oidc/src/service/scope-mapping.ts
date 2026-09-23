import { type EffectiveRole } from '@odudu/domain-authz';

// A role reaches a token only if the granted scopes reach it. Without this,
// one login tells a client the tenant's entire role vocabulary.
export function narrowByScopeMappings(
  held: readonly EffectiveRole[],
  reachableRoleIds: ReadonlySet<string>,
  fullScopeAllowed: boolean,
): readonly EffectiveRole[] {
  if (fullScopeAllowed) return held;
  return held.filter((role) => reachableRoleIds.has(role.roleId));
}
