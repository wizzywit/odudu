import { useEffect, useRef, useState } from 'react';
import { useDirtySection } from '#/shared/repository/useDirtySection';
import { sectionKey } from '#/shared/services/record';
import { useDrafts, type DraftFields, type KeptDraft } from '#/shared/repository/useDrafts';
import { useLatest } from '#/shared/repository/useLatest';

export interface SectionDraft {
  // Edits kept when a session ended, handed back once; the section applies
  // them as its own unsaved edits, and nothing is sent until somebody saves.
  // `restored.etag` is the ETag they were made against, which tells whether
  // the record has moved on since.
  restored: KeptDraft | null;
  // Called once the restored edits are saved or discarded.
  settle: () => void;
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
  tenant: string;
  record: string;
  section: string;
  label: string;
  dirty: boolean;
  fields: DraftFields;
  // The ETag the section loaded with, or null for a record not read yet.
  etag: string | null;
}): SectionDraft {
  const record = `${tenant}/${path}`;
  useDirtySection(sectionKey(tenant, path, section), label, dirty);
  const latest = useLatest({ dirty, fields, etag });
  const register = useDrafts((drafts) => drafts.register);
  const restore = useDrafts((drafts) => drafts.restore);
  const forget = useDrafts((drafts) => drafts.forget);
  const [restored, setRestored] = useState(() => restore(record, section));
  const kept = useRef(restored?.etag ?? null);
  useEffect(
    () =>
      register({
        record,
        section,
        dirty: () => latest().dirty,
        fields: () => latest().fields,
        etag: () => kept.current ?? latest().etag,
      }),
    [register, record, section, latest],
  );
  useEffect(() => {
    if (restored !== null) forget(record, section);
  }, [forget, restored, record, section]);

  return {
    restored,
    settle: () => {
      kept.current = null;
      setRestored(null);
      forget(record, section);
    },
  };
}
