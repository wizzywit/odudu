import type { TenantSession } from '#/pages/tenant-sessions/types/tenantSession';
import { nameOrId } from '#/shared/services/ids';

// A subject is named by its username where it has one; its id is what the
// link and the detail go by.
export function subjectCell(session: Pick<TenantSession, 'subjectId' | 'username'>): {
  label: string;
  id: string;
} {
  return {
    label: nameOrId({ id: session.subjectId, username: session.username }),
    id: session.subjectId,
  };
}

// Where a session's subject has its page, for a caller who may read subjects.
export function subjectLinkOf(
  mayRead: boolean,
  tenant: string,
  href: (tenant: string, id: string) => string,
): ((id: string) => string) | null {
  return mayRead ? (id) => href(tenant, id) : null;
}
