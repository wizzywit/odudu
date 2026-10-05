import type { ReactNode } from 'react';
import { Note, NoteCode } from '#/shared/view/Note';

export function CapabilityNote({
  capability,
  children = 'This',
}: {
  capability: string;
  children?: ReactNode;
}) {
  return (
    <Note>
      {children} needs the <NoteCode>{capability}</NoteCode> capability.
    </Note>
  );
}
