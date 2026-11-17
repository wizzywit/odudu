import {
  endTenantSessionsResponseSchema,
  listTenantSessionsResponseSchema,
  type ListTenantSessionsResponse,
  type TenantSession as WireSession,
} from '@odudu/contracts/admin';
import { adminCall, listReader, mapResult } from '#/shared/api/adapter/route';
import type { ListPage } from '#/shared/lib/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { SessionsEnded, TenantSession } from '#/pages/tenant-sessions/types/tenantSession';

const readWirePage = listReader('sessions', listTenantSessionsResponseSchema);

function sessionOf(wire: WireSession): TenantSession {
  return {
    id: wire.id,
    subjectId: wire.subject_id,
    username: wire.username,
    createdAt: wire.created_at,
    lastActiveAt: wire.last_active_at,
    remembered: wire.remembered,
    clientIds: wire.client_ids,
    device: wire.device,
  };
}

function pageOf(wire: ListTenantSessionsResponse): ListPage<TenantSession> {
  return { items: wire.items.map(sessionOf), next: wire.next };
}

export async function readTenantSessionPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<TenantSession>>> {
  return mapResult(await readWirePage(gateway, tenant, query), pageOf);
}

// At most 500 sessions per call: `remaining` says whether to call again.
export async function endTenantSessions(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<SessionsEnded>> {
  const result = await adminCall(gateway, 'DELETE', tenant, ['sessions'], {
    schema: endTenantSessionsResponseSchema,
  });
  return mapResult(result, ({ ended, remaining, beyond_ceiling }) => ({
    ended,
    remaining,
    beyondCeiling: beyond_ceiling,
  }));
}
