import { useState } from 'react';
import { actorNote } from '#/entities/audit-event/services/actorOrigin';
import {
  detailEntries,
  eventTimes,
  hasChange,
  omittedNote,
  valueShown,
  type DetailEntry,
} from '#/entities/audit-event/services/eventDetail';
import { requestNoteOf } from '#/entities/audit-event/services/requestCorrelation';
import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';

export interface AuditDetailState {
  times: { local: string; utc: string };
  actorNote: string | null;
  // Present only where the row has a request id.
  requestNote: string | null;
  entries: readonly DetailEntry[];
  changed: boolean;
  omittedNote: string | null;
}

// Every field of one event as text a person can read.
export function useAuditDetail(event: AuditEvent, zone: string | undefined): AuditDetailState {
  const { entries, omitted } = detailEntries(event.detail);
  return {
    times: eventTimes(event.occurred_at, zone),
    actorNote: actorNote(event),
    requestNote: requestNoteOf(event.request_id),
    entries,
    changed: hasChange(entries),
    omittedNote: omittedNote(omitted),
  };
}

// One detail value, cut where it is long until the reader asks for it whole.
export function useDetailValue(text: string): {
  shown: string;
  truncated: boolean;
  whole: boolean;
  toggle: () => void;
} {
  const [whole, setWhole] = useState(false);
  return {
    ...valueShown(text, whole),
    whole,
    toggle: () => {
      setWhole(!whole);
    },
  };
}
