import type { ReactNode } from 'react';
import { SectionNoticeOf, type NoticeSave } from '#/shared/view/SectionNoticeOf';
import { Section } from '#/shared/view/Section';

// What a section reads of its save, whatever fields the save holds.
interface Controls extends NoticeSave {
  dirty: boolean;
  restored: boolean;
  blocked: string | undefined;
  discard: () => void;
  submit: () => boolean;
}

// A section of the client's record: its title, its save bar and its notice,
// wired to one section's save.
export function SaveSection({
  title,
  description,
  save,
  blocked,
  children,
}: {
  title: string;
  description?: ReactNode;
  save: Controls;
  // Holds Save with this reason, ahead of the save's own.
  blocked?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Section
      title={title}
      {...(description === undefined ? {} : { description })}
      dirty={save.dirty}
      saving={save.saving}
      onSave={save.submit}
      onDiscard={save.discard}
      restored={save.restored}
      blocked={blocked ?? save.blocked}
      notice={<SectionNoticeOf title={title} save={save} />}
    >
      {children}
    </Section>
  );
}
