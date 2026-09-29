import { useEffect, useRef, useState } from 'react';
import { useDirtySection } from '#/shared/repository/useDirtySection.ts';
import { useDrafts, type DraftFields, type KeptDraft } from '#/shared/repository/useDrafts.ts';

export interface SectionDraft {
  // Edits kept when a session ended, handed back once; the section applies
  // them as its own unsaved edits, and nothing is sent until somebody saves.
  // `restored.etag` is the ETag they were made against, which tells whether
  // the record has moved on since.
  readonly restored: KeptDraft | null;
  // Called once the restored edits are saved or discarded.
  readonly settle: () => void;
}

// A draft is keyed by the tenant as well as the record, since a system
// administrator reaches the same record path in every tenant.
export function useSectionDraft({
  tenant,
  record: path,
  section,
  label,
  dirty,
  fields,
  etag,
}: {
  readonly tenant: string;
  readonly record: string;
  readonly section: string;
  readonly label: string;
  readonly dirty: boolean;
  readonly fields: DraftFields;
  // The ETag the section loaded with, or null for a record not read yet.
  readonly etag: string | null;
}): SectionDraft {
  const record = `${tenant}/${path}`;
  useDirtySection(`${record}#${section}`, label, dirty);
  const latest = useRef({ dirty, fields, etag });
  useEffect(() => {
    latest.current = { dirty, fields, etag };
  });
  const drafts = useDrafts.getState();
  const [restored, setRestored] = useState(() => drafts.restore(record, section));
  const kept = useRef(restored?.etag ?? null);
  useEffect(
    () =>
      drafts.register({
        record,
        section,
        dirty: () => latest.current.dirty,
        fields: () => latest.current.fields,
        etag: () => kept.current ?? latest.current.etag,
      }),
    [drafts, record, section],
  );
  useEffect(() => {
    if (restored !== null) drafts.forget(record, section);
  }, [drafts, restored, record, section]);

  return {
    restored,
    settle: () => {
      kept.current = null;
      setRestored(null);
      drafts.forget(record, section);
    },
  };
}
