import type { AuditEvent } from '@odudu/contracts/admin';
import { tenantPage } from '#/shared/services/address';

export type RecordPages = Readonly<Record<string, (tenant: string, id: string) => string>>;

// A page that is the whole of what the audit log names, with no record of its own.
const AREA_PAGES: Readonly<Record<string, string>> = {
  signing_key: 'keys',
  flow: 'flow',
  registration_token: 'registration-tokens',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// The record a resource id names, or the page its type lives on. A reserved
// client_id or a session digest is a resource id too, and names no record.
export function resourceHref(
  tenant: string,
  type: string | null,
  id: string | null,
  pages: RecordPages,
): string | null {
  if (type === null || id === null) return null;
  const area = AREA_PAGES[type];
  if (area !== undefined) return `${tenantPage(tenant)}/${area}`;
  const page = pages[type];
  return page === undefined || !UUID.test(id) ? null : page(tenant, id);
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
