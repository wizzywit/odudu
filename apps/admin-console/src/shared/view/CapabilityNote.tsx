import type { ReactNode } from 'react';
import styles from '#/shared/view/CapabilityNote.module.css';

export function CapabilityNote({
  capability,
  children = 'This',
}: {
  readonly capability: string;
  readonly children?: ReactNode;
}) {
  return (
    <p role="note" className={styles.note}>
      {children} needs the <code className={styles.capability}>{capability}</code> capability.
    </p>
  );
}
