import type { AuditEvent } from '@odudu/contracts/admin';
export type RecordPages = Readonly<Record<string, (tenant: string, id: string) => string>>;

// The resource types that are a whole area, with no record of their own, and
// the area each opens.
export const AREA_RESOURCES: Readonly<Record<string, string>> = {
  signing_key: 'keys',
  flow: 'flow',
  registration_token: 'registration-tokens',
};

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// A reserved client_id or a session digest is a resource id too, and names no record.
function isRecordId(id: string): boolean {
  return RECORD_ID.test(id);
}

// The record a resource id names, or the page its type lives on.
export function resourceHref(
  tenant: string,
  type: string | null,
  id: string | null,
  pages: RecordPages,
  areaPage: (area: string) => string,
): string | null {
  if (type === null || id === null) return null;
  const area = AREA_RESOURCES[type];
  if (area !== undefined) return areaPage(area);
  const page = pages[type];
  return page === undefined || !isRecordId(id) ? null : page(tenant, id);
}

// An actor links to its subject only where this tenant's subjects are
// readable to the caller and the actor is one of them.
export function actorHref(
  tenant: string,
  event: Pick<AuditEvent, 'actor_subject_id' | 'actor_origin'>,
  mayReadSubjects: boolean,
  subjectPage: (tenant: string, id: string) => string,
): string | null {
  const id = event.actor_subject_id;
  if (id === null || event.actor_origin !== 'tenant' || !mayReadSubjects) return null;
  return subjectPage(tenant, id);
}
