import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';
import { counted } from '#/shared/services/format';

const LABEL_LENGTH = 6;

// A request id as a short handle the same id always has, so two rows read as
// one request without comparing 36 characters.
export function requestLabel(id: string): string {
  return `request ${id.slice(-LABEL_LENGTH)}`;
}

// The ids more than one of these rows carry, with how many do. Only the rows
// loaded are counted: the API cannot filter by request.
export function requestRowCounts(
  events: readonly Pick<AuditEvent, 'request_id'>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { request_id: id } of events) {
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map([...counts].filter(([, count]) => count > 1));
}

// What marks a row as one of several written for the same request.
export function correlationTags(
  events: readonly Pick<AuditEvent, 'request_id'>[],
): ReadonlyMap<string, string> {
  return new Map(
    [...requestRowCounts(events)].map(([id, rows]) => [
      id,
      `${requestLabel(id)} · ${counted(rows, 'row', 'rows')} loaded`,
    ]),
  );
}

// What one row's request id comes with in its details, where it has one.
export function requestNoteOf(id: string | null): string | null {
  if (id === null) return null;
  return `Label ${requestLabel(id)}. The caller can set it, so it is a correlation, not evidence.`;
}

export const CORRELATION_NOTE =
  'Rows with the same request id were written for one request, and are labelled as such. The server cannot filter by request, so a label groups only the rows loaded here. The caller can set the id, so it is a correlation, not evidence.';
