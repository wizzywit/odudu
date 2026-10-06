import type { RevokeClientGrantsResponse, TenantSession } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import {
  readClientSessionCount,
  readClientSessions,
  revokeClientGrants,
} from '#/features/clients/adapter/operations.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Who is signed in through the client, a page at a time and counted.
export function useClientSessionList(
  tenant: string,
  clientDbId: string,
): ResourceListState<TenantSession> {
  return useResourceList({
    tenant,
    resource: `clients/${clientDbId}/sessions`,
    read: (gateway, query) => readClientSessions(gateway, tenant, clientDbId, query),
    count: (gateway) => readClientSessionCount(gateway, tenant, clientDbId),
  });
}

export interface GrantRevocation {
  busy: boolean;
  run: () => Promise<GatewayResult<RevokeClientGrantsResponse>>;
}

export function useGrantRevocation(tenant: string, clientDbId: string): GrantRevocation {
  const { gateway } = useTransport();
  const mutation = useMutation({
    mutationFn: () => revokeClientGrants(gateway, tenant, clientDbId),
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}
