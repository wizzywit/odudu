import type { SectionSave } from '#/features/roles/usecase/useRoleGeneral.ts';
import { SectionNotice } from '#/shared/view/SectionNotice.tsx';

export function SectionNoticeOf<T extends Readonly<Record<string, unknown>>>({
  title,
  save,
}: {
  title: string;
  save: SectionSave<T>;
}) {
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
