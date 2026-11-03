import type { AssignedScopes, Scope } from '#/entities/scope';
import { assignScope, unassignScope } from '#/shared/adapter/scopeAssignment';
import { useRereadClient } from '#/features/clients/repository/useClientRecord';
import { readScopePage } from '#/shared/adapter/directory';
import { usePicker } from '#/shared/repository/usePicker';
import type { PickerState } from '#/shared/services/picker';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useWrite, type Write } from '#/shared/repository/useWrite';

// The tenant's scopes, searched by name on the server a page at a time.
export function useScopePicker(tenant: string): PickerState<Scope> {
  return usePicker({
    tenant,
    resource: 'scopes',
    read: (gateway, query) => readScopePage(gateway, tenant, query),
  });
}

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
