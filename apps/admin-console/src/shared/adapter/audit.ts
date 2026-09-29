import { listAuditResponseSchema, type ListAuditResponse } from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

// Shared by the Audit trail and every record's Activity tab, which is the
// same list narrowed to one resource.
export function readAuditPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListAuditResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${encodeURIComponent(tenant)}/audit?${query.toString()}`,
    {
      schema: listAuditResponseSchema,
    },
  );
}
