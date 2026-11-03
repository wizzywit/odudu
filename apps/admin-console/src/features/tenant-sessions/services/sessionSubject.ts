import type { TenantSession } from '@odudu/contracts/admin';
import { nameOrId } from '#/shared/services/ids';

// A subject is named by its username where it has one; its id is what the
// link and the detail go by.
export function subjectCell(session: Pick<TenantSession, 'subject_id' | 'username'>): {
  label: string;
  id: string;
} {
  return {
    label: nameOrId({ id: session.subject_id, username: session.username }),
    id: session.subject_id,
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
