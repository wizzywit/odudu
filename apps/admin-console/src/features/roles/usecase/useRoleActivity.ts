import type { AuditEvent } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useActivity } from '#/shared/repository/useActivity.ts';
import { notLacking } from '#/shared/service/access.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// whoami is advice: a caller it says cannot read the audit trail is told so,
// rather than sent a read the server would refuse.
export function useAuditReadable(tenant: string): boolean {
  return notLacking(useAuthority(tenant), ['view-audit']);
}

export function useRoleActivity(tenant: string, id: string): ResourceListState<AuditEvent> {
  return useActivity({ tenant, resourceType: 'role', resourceId: id });
}
