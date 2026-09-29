import type { ReactNode } from 'react';
import styles from '#/shared/view/StatusTag.module.css';

// Amber is reserved for system authority, so its tone says so by name rather
// than lending itself to any status that wants to look important.
export type StatusTone = 'neutral' | 'active' | 'warning' | 'danger' | 'system-authority';

export function StatusTag({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={styles.tag} data-tone={tone}>
      {children}
    </span>
  );
}
