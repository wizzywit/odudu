import { assignScope, unassignScope, type AssignedScopes } from '#/entities/scope';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useWrite, type Write } from '#/shared/repository/useWrite';

export interface ScopeChanges {
  assign: Write<
    { scopeId: string; assignment: 'default' | 'optional' },
    GatewayResult<AssignedScopes>
  >;
  unassign: Write<{ scopeId: string }, GatewayResult<undefined>>;
}

// An assignment changes the client's own ETag, which covers its scopes, so
// the record is read again once either settles.
export function useScopeChanges(tenant: string, clientDbId: string): ScopeChanges {
  const reread = useRereadClient(tenant, clientDbId);
  const assign = useWrite({
    send: (
      gateway,
      { scopeId, assignment }: { scopeId: string; assignment: 'default' | 'optional' },
    ) => assignScope(gateway, tenant, scopeId, clientDbId, assignment),
    onSettled: reread,
  });
  const unassign = useWrite({
    send: (gateway, { scopeId }: { scopeId: string }) =>
      unassignScope(gateway, tenant, scopeId, clientDbId),
    onSettled: reread,
  });
  return { assign, unassign };
}
