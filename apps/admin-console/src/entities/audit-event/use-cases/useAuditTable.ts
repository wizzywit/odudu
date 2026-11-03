import { useState } from 'react';
import { elsewhereNoteOf } from '#/entities/audit-event/services/actorOrigin';
import { AUDIT_EVENT_TITLE, eventDescription } from '#/entities/audit-event/services/eventDetail';
import { correlationTags } from '#/entities/audit-event/services/requestCorrelation';
import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';

export interface AuditTableState {
  open: AuditEvent | null;
  openRow: (event: AuditEvent) => void;
  closeRow: () => void;
  // Where a request id is shared by loaded rows, what marks each of them.
  tags: ReadonlyMap<string, string>;
  elsewhereNote: string | null;
  dialogTitle: string;
  dialogDescription: string;
}

// The one row a table has open to every field, and what its notes say.
export function useAuditTable(rows: readonly AuditEvent[]): AuditTableState {
  const [open, setOpen] = useState<AuditEvent | null>(null);
  return {
    open,
    openRow: setOpen,
    closeRow: () => {
      setOpen(null);
    },
    tags: correlationTags(rows),
    elsewhereNote: elsewhereNoteOf(rows),
    dialogTitle: AUDIT_EVENT_TITLE,
    dialogDescription: eventDescription(open),
  };
}
