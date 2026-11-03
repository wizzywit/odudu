import { listAuditResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { AuditPage } from '#/entities/audit-event/types/auditEvent';

const readWirePage = listReader('audit', listAuditResponseSchema);

// Shared by the Audit trail, the overview and every record's Activity tab,
// which is the same list narrowed to one resource.
export function readAuditPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<AuditPage>> {
  return readWirePage(gateway, tenant, query);
}
