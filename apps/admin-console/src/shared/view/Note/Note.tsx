import type { ReactNode } from 'react';
import styles from '#/shared/view/Note/Note.module.css';

// A dashed one-line aside: what a page cannot offer, and what it needs.
export function Note({ children }: { children: ReactNode }) {
  return (
    <p role="note" className={styles.note}>
      {children}
    </p>
  );
}

export function NoteCode({ children }: { children: ReactNode }) {
  return <code className={styles.capability}>{children}</code>;
}
