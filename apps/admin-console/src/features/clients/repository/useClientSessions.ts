import type { ClientSession, RevokedGrants } from '#/features/clients/types/clientSession';
import {
  readClientSessionCount,
  readClientSessions,
  revokeClientGrants,
} from '#/features/clients/adapter/operations';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useWrite, type Write } from '#/shared/repository/useWrite';

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
