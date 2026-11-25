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
