import type { ScopeClient } from '#/pages/scopes/types/scopeClient';
import { useQueryClient } from '@tanstack/react-query';
import { readScopeClients } from '#/pages/scopes/adapter/scopes';
import { type AssignedScopes, assignScope, unassignScope } from '#/entities/scope';
import { withoutScope, withScopes } from '#/pages/scopes/services/clientScopesCache';
import { recordKey, scopeClientsKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import type { RecordEntry } from '#/shared/repository/useRecord';
import { useListPages } from '#/shared/repository/useResourceList';
import type { ListStatus } from '#/shared/services/resourceList';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useWrite } from '#/shared/repository/useWrite';

// What the console holds of a client that a scope's assignment changes.
interface ClientRecord {
  scopes: AssignedScopes['scopes'];
}

export interface ScopeClients {
  status: ListStatus;
  rows: readonly ScopeClient[];
  more: boolean;
  loadingMore: boolean;
  loadLimited: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

// The clients that carry the scope, a page at a time: the server answers in
// the order of its index, so "Load more" is the only way through.
export function useScopeClients(tenant: string, id: string, enabled = true): ScopeClients {
  const pages = useListPages({
    key: scopeClientsKey(tenant, id),
    query: new URLSearchParams(),
    cursor: undefined,
    enabled,
    read: (gateway, query) => readScopeClients(gateway, tenant, id, query),
  });
  return {
    status: pages.status,
    rows: pages.rows,
    more: pages.next !== null,
    loadingMore: pages.loadingMore,
    loadLimited: pages.loadLimited,
    loadMoreFailed: pages.loadMoreFailed,
    loadMore: pages.loadMore,
    retry: pages.retry,
  };
}

export interface AssignInput {
  clientId: string;
  assignment: 'default' | 'optional';
}

// An assignment changes the client's own ETag, which covers its scopes, and
// the answer carries the new one. A client the console already holds is
// rebased on it, so its page saves on that ETag even before it has read the
// client again. Without an ETag in the answer, or a record to rebase, what is
// held is dropped instead, and the page waits for a fresh read.
function useAfterAssignment(tenant: string, id: string) {
  const client = useQueryClient();
  const { invalidate } = useInvalidate();
  return (
    clientDbId: string,
    answered: GatewayResult<unknown> | undefined,
    rebase: (held: ClientRecord) => ClientRecord,
  ): void => {
    invalidate(scopeClientsKey(tenant, id));
    const key = recordKey(tenant, `clients/${clientDbId}`);
    const held = client.getQueryData<RecordEntry<ClientRecord>>(key);
    if (answered?.ok === true && answered.etag !== null && held !== undefined) {
      client.setQueryData<RecordEntry<ClientRecord>>(key, {
        by: 'save',
        result: { ...held.result, etag: answered.etag, data: rebase(held.result.data) },
      });
    } else {
      client.removeQueries({ queryKey: key, exact: true });
    }
  };
}

export function useClientAssignment(tenant: string, id: string) {
  const settled = useAfterAssignment(tenant, id);
  const assign = useWrite({
    send: (gateway, { clientId, assignment }: AssignInput) =>
      assignScope(gateway, tenant, id, clientId, assignment),
    onSettled: (result, { clientId }) => {
      settled(clientId, result, (held) =>
        result?.ok === true ? withScopes(held, result.data.scopes) : held,
      );
    },
  });
  const unassign = useWrite({
    send: (gateway, { clientId }: { clientId: string }) =>
      unassignScope(gateway, tenant, id, clientId),
    onSettled: (result, { clientId }) => {
      settled(clientId, result, (held) => withoutScope(held, id));
    },
  });
  return { assign, unassign };
}
