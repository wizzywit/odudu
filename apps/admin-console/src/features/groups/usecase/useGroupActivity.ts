import type { AuditEvent } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { useActivity } from '#/shared/repository/useActivity.ts';
import { lacking } from '#/shared/service/access.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// whoami is advice: a caller it says cannot read the audit trail is told so,
// rather than sent a read the server would refuse.
export function useAuditReadable(tenant: string): boolean {
  return lacking(useAuthority(tenant), ['view-audit']).length === 0;
}

export function useGroupActivity(tenant: string, id: string): ResourceListState<AuditEvent> {
  return useActivity({ tenant, resourceType: 'group', resourceId: id });
}
