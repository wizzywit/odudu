import type { ActorOrigin, AuditEvent } from '#/entities/audit-event/types/auditEvent';

export function isElsewhere(origin: ActorOrigin | null): boolean {
  return origin === 'system' || origin === 'other-tenant';
}

// Why a caller from elsewhere has no name here: the API resolves a name only
// within the row's own tenant (ADR 0037).
export function elsewhereReason(origin: ActorOrigin | null): string | null {
  if (origin === 'system') {
    return 'A system administrator acting across tenants. Its tenant is the system tenant, not this one, so this tenant cannot name it; its id is shown instead.';
  }
  if (origin === 'other-tenant') {
    return "A token issued by another tenant, presented here and refused. This tenant cannot resolve another tenant's subject to a name; its id is shown instead.";
  }
  return null;
}

// The name an actor is shown under: a caller from elsewhere is what they are,
// since this tenant cannot name them; any other is the name the API resolved.
export function actorName(event: Pick<AuditEvent, 'actor_name' | 'actor_origin'>): string | null {
  if (event.actor_origin === 'system') return 'a system administrator';
  if (event.actor_origin === 'other-tenant') return "another tenant's caller";
  return event.actor_name;
}

// Who an audit row says acted: the name it is shown under, and whether the
// caller is from elsewhere.
export function auditActorOf(event: Pick<AuditEvent, 'actor_name' | 'actor_origin'>): {
  name: string | null;
  elsewhere: boolean;
} {
  return { name: actorName(event), elsewhere: isElsewhere(event.actor_origin) };
}

const NAME_NOT_SHOWN =
  'A name is shown only to a caller who holds view-users, and only while the subject still exists; the id is always here.';

// What a reader needs to know about an actor besides who it is, where the row
// cannot say it: why there is no name.
export function actorNote(
  event: Pick<AuditEvent, 'actor_subject_id' | 'actor_name' | 'actor_origin'>,
): string | null {
  if (event.actor_subject_id === null) return null;
  const reason = elsewhereReason(event.actor_origin);
  if (reason !== null) return reason;
  return event.actor_name === null ? NAME_NOT_SHOWN : null;
}

export const ELSEWHERE_NOTE =
  'Marked from elsewhere: the caller’s tenant is not this one, so this tenant cannot name them. It is a system administrator acting across tenants, or a token another tenant issued and this one refused.';

// The note under a table that has a row from elsewhere, and none that has not.
export function elsewhereNoteOf(
  events: readonly Pick<AuditEvent, 'actor_origin'>[],
): string | null {
  return events.some((event) => isElsewhere(event.actor_origin)) ? ELSEWHERE_NOTE : null;
}
