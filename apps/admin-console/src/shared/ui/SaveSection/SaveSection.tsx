import type { ReactNode } from 'react';
import { SectionNoticeOf, type NoticeSave } from '#/shared/ui/SectionNoticeOf';
import { Section } from '#/shared/ui/Section';

// What a section reads of its save, whatever fields the save holds.
interface Controls extends NoticeSave {
  dirty: boolean;
  restored: boolean;
  blocked: string | undefined;
  discard: () => void;
  submit: () => boolean;
}

// A section of a record: its title, its save bar and its notice, wired to
// one section's save.
export function SaveSection({
  title,
  description,
  saveLabel,
  headingId,
  save,
  blocked,
  noticeTitle,
  onSave,
  children,
}: {
  title: string;
  description?: ReactNode;
  // What Save does, where "Save" and the title would read oddly.
  saveLabel?: string;
  // The heading's id, for a page that sends the focus to it.
  headingId?: string;
  save: Controls;
  // Holds Save with this reason, ahead of the save's own.
  blocked?: string | undefined;
  // What the notice calls the section, where its heading is not the name.
  noticeTitle?: string;
  // Saves in place of the save's own submit, as where a confirmation comes first.
  onSave?: () => unknown;
  children: ReactNode;
}) {
  return (
    <Section
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(saveLabel === undefined ? {} : { saveLabel })}
      {...(headingId === undefined ? {} : { headingId })}
      dirty={save.dirty}
      saving={save.saving}
      onSave={onSave ?? save.submit}
      onDiscard={save.discard}
      restored={save.restored}
      blocked={blocked ?? save.blocked}
      notice={<SectionNoticeOf title={noticeTitle ?? title} save={save} />}
    >
      {children}
    </Section>
  );
}
