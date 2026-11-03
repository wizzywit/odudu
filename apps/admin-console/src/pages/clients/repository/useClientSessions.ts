import type { ClientSession, RevokedGrants } from '#/pages/clients/types/clientSession';
import {
  readClientSessionCount,
  readClientSessions,
  revokeClientGrants,
} from '#/pages/clients/adapter/operations';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';

// Who is signed in through the client, a page at a time and counted.
export function useClientSessionList(
  tenant: string,
  clientDbId: string,
): ResourceListState<ClientSession> {
  return useResourceList({
    tenant,
    resource: `clients/${clientDbId}/sessions`,
    read: (gateway, query) => readClientSessions(gateway, tenant, clientDbId, query),
    count: (gateway) => readClientSessionCount(gateway, tenant, clientDbId),
  });
}

export function useGrantRevocation(
  tenant: string,
  clientDbId: string,
): Write<void, GatewayResult<RevokedGrants>> {
  return useWrite({ send: (gateway) => revokeClientGrants(gateway, tenant, clientDbId) });
}
