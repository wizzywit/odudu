import type { ReactNode } from 'react';
import styles from '#/shared/ui/More/More.module.css';

// What a field says beyond its one line, folded away until a person asks.
export function More({ children, label }: { children: ReactNode; label: string }) {
  return (
    <details className={styles.more}>
      <summary className={styles.summary}>{label}</summary>
      <p className={styles.body}>{children}</p>
    </details>
  );
}
