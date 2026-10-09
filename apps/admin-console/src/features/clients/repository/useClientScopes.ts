import type { AssignScopeToClientResponse, ClientScope } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { assignScope, unassignScope } from '#/features/clients/adapter/scopes.ts';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import { readScopePage } from '#/shared/adapter/directory.ts';
import { usePicker } from '#/shared/repository/usePicker.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// The tenant's scopes, searched by name on the server a page at a time.
export function useScopePicker(tenant: string): PickerState<ClientScope> {
  return usePicker({
    tenant,
    resource: 'scopes',
    read: (gateway, query) => readScopePage(gateway, tenant, query),
  });
}

export interface ScopeChange<A, R> {
  busy: boolean;
  run: (arg: A) => Promise<GatewayResult<R>>;
}

export interface ScopeChanges {
  assign: ScopeChange<
    { scopeId: string; assignment: 'default' | 'optional' },
    AssignScopeToClientResponse
  >;
  unassign: ScopeChange<{ scopeId: string }, undefined>;
}

// An assignment changes the client's own ETag, which covers its scopes, so
// the record is read again once either settles.
export function useScopeChanges(tenant: string, clientDbId: string): ScopeChanges {
  const { gateway } = useTransport();
  const reread = useRereadClient(tenant, clientDbId);
  const assign = useMutation({
    mutationFn: ({
      scopeId,
      assignment,
    }: {
      scopeId: string;
      assignment: 'default' | 'optional';
    }) => assignScope(gateway, tenant, scopeId, clientDbId, assignment),
    onSettled: reread,
  });
  const unassign = useMutation({
    mutationFn: ({ scopeId }: { scopeId: string }) =>
      unassignScope(gateway, tenant, scopeId, clientDbId),
    onSettled: reread,
  });
  return {
    assign: { busy: assign.isPending, run: (arg) => assign.mutateAsync(arg) },
    unassign: { busy: unassign.isPending, run: (arg) => unassign.mutateAsync(arg) },
  };
}
