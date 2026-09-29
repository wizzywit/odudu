import type { AuditEvent } from '@odudu/contracts/admin';
import { readAuditPage } from '#/shared/adapter/audit.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// A record's Activity is the audit trail with its resource fixed; the API
// refuses `resource_id` without `resource_type`, so both are required here.
export function useActivity({
  tenant,
  resourceType,
  resourceId,
}: {
  readonly tenant: string;
  readonly resourceType: string;
  readonly resourceId: string;
}): ResourceListState<AuditEvent> {
  return useResourceList({
    tenant,
    resource: `audit/${resourceType}/${resourceId}`,
    fixed: { resource_type: resourceType, resource_id: resourceId },
    read: (gateway, query) => readAuditPage(gateway, tenant, query),
  });
}
