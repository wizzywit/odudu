import { useEffect, useRef, useState } from 'react';
import { useDirtySection } from '#/shared/repository/useDirtySection.ts';
import { useDrafts, type DraftFields, type DraftValues } from '#/shared/repository/useDrafts.ts';

export interface SectionDraft {
  // Edits kept when a session ended, handed back once; the section applies
  // them as its own unsaved edits, and nothing is sent until somebody saves.
  readonly restored: DraftValues | null;
  // Called once the restored edits are saved or discarded.
  readonly settle: () => void;
}

export function useSectionDraft({
  record,
  section,
  label,
  dirty,
  fields,
}: {
  readonly record: string;
  readonly section: string;
  readonly label: string;
  readonly dirty: boolean;
  readonly fields: DraftFields;
}): SectionDraft {
  useDirtySection(`${record}#${section}`, label, dirty);
  const latest = useRef({ dirty, fields });
  useEffect(() => {
    latest.current = { dirty, fields };
  });
  const drafts = useDrafts.getState();
  useEffect(
    () =>
      drafts.register({
        record,
        section,
        dirty: () => latest.current.dirty,
        fields: () => latest.current.fields,
      }),
    [drafts, record, section],
  );

  const [restored, setRestored] = useState(() => drafts.restore(record, section));
  useEffect(() => {
    if (restored !== null) drafts.forget(record, section);
  }, [drafts, restored, record, section]);

  return {
    restored,
    settle: () => {
      setRestored(null);
      drafts.forget(record, section);
    },
  };
}
