import { useAuthority } from '#/entities/session/use-cases/useAuthority';
import { notLacking } from '#/shared/lib/services/access';

// whoami is advice: a caller it says cannot read the audit trail is told so,
// rather than sent a read the server would refuse.
export function useAuditReadable(tenant: string): boolean {
  return notLacking(useAuthority(tenant), ['view-audit']);
}
