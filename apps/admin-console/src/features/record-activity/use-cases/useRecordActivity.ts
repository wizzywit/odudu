import type { AuditEvent } from '#/entities/audit-event';
import { useActivity } from '#/features/record-activity/repository/useActivity';
import type { ResourceListState } from '#/shared/services/resourceList';

// The audit trail of one record, whose `resourceType` is the audit log's name for it.
export function useRecordActivity(
  resourceType: string,
  tenant: string,
  id: string,
): ResourceListState<AuditEvent> {
  return useActivity({ tenant, resourceType, resourceId: id });
}
