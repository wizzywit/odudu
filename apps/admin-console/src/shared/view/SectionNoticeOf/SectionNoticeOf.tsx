import type { Conflict } from '#/shared/service/conflict.ts';
import type { ConflictSource, SaveStatus } from '#/shared/service/sectionSave';
import { SectionNotice } from '#/shared/view/SectionNotice';

// A section's save, as its notice reads it: `useSectionSave`'s answer to
// every section of every record, so a page hands it over whole.
export interface NoticeSave {
  status: SaveStatus;
  conflicts: readonly Conflict[];
  conflictSource: ConflictSource;
  message: string | null;
  saving: boolean;
  keepMine: () => void;
  takeTheirs: () => void;
  reread: () => void;
}

export function SectionNoticeOf({ title, save }: { title: string; save: NoticeSave }) {
  return (
    <SectionNotice
      section={title}
      status={save.status}
      conflicts={save.conflicts}
      conflictSource={save.conflictSource}
      message={save.message}
      busy={save.saving}
      onKeepMine={save.keepMine}
      onTakeTheirs={save.takeTheirs}
      onReread={save.reread}
    />
  );
}
