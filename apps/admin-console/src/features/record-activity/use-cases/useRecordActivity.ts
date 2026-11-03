import { readAuditPage, type AuditEvent } from '#/entities/audit-event';
import {
  activityWords,
  type ActivityWords,
} from '#/features/record-activity/services/activityWords';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';

// A record's Activity is the audit trail with its resource fixed; the API
// refuses `resource_id` without `resource_type`, so both are required here.
// `resourceType` is the audit log's name for the record. Where the audit
// would refuse the read, nothing is asked of it and only the words are used.
export function useRecordActivity(
  resourceType: string,
  tenant: string,
  id: string,
  readable = true,
): { list: ResourceListState<AuditEvent>; words: ActivityWords } {
  const list = useResourceList({
    tenant,
    enabled: readable,
    resource: `audit/${resourceType}/${id}`,
    fixed: { resource_type: resourceType, resource_id: id },
    read: (gateway, query) => readAuditPage(gateway, tenant, query),
  });
  return { list, words: activityWords(resourceType) };
}
