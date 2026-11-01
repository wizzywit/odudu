import type { ReactNode } from 'react';
import styles from '#/shared/view/Note/Note.module.css';

// A dashed one-line aside: what a page cannot offer, and what it needs.
// `warning` sets it apart as advice worth acting on, still not an error.
export function Note({
  children,
  tone,
  id,
}: {
  children: ReactNode;
  tone?: 'warning' | undefined;
  id?: string;
}) {
  return (
    <p id={id} role="note" className={styles.note} data-tone={tone}>
      {children}
    </p>
  );
}

export function NoteCode({ children }: { children: ReactNode }) {
  return <code className={styles.capability}>{children}</code>;
}
