import type { TenantSession } from '#/pages/tenant-sessions/types/tenantSession';

// A subject is shown by the label it was given; its id is what the link and
// the detail go by.
export function subjectCell(
  session: Pick<TenantSession, 'subjectId'>,
  label: string,
): {
  label: string;
  id: string;
} {
  return { label, id: session.subjectId };
}

// Where a session's subject has its page, for a caller who may read subjects.
export function subjectLinkOf(
  mayRead: boolean,
  tenant: string,
  href: (tenant: string, id: string) => string,
): ((id: string) => string) | null {
  return mayRead ? (id) => href(tenant, id) : null;
}
