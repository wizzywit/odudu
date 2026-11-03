import { segment } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult, RawBody } from '#/shared/api/transport/gateway';

// The events a listing's filters match, as the NDJSON the server wrote.
export function exportAuditEvents(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<RawBody>> {
  const t = segment(tenant);
  const search = query.toString();
  return search === ''
    ? gateway.download('GET', `admin/tenants/${t}/audit/export`)
    : gateway.download('GET', `admin/tenants/${t}/audit/export?${search}`);
}
