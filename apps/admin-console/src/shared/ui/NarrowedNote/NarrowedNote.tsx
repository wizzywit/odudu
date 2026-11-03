import type { ReactNode } from 'react';
import { Button } from '#/shared/ui/Button';
import styles from '#/shared/ui/NarrowedNote/NarrowedNote.module.css';

// What a list has been narrowed to by one record, with the way back to all.
export function NarrowedNote({
  children,
  all,
  onClear,
}: {
  children: ReactNode;
  // The button's text: "Show every role".
  all: string;
  onClear: () => void;
}) {
  return (
    <p className={styles.narrowed}>
      <span>{children}</span>
      <Button size="small" variant="quiet" onPress={onClear}>
        {all}
      </Button>
    </p>
  );
}
