import type { ReactNode } from 'react';
import styles from '#/shared/view/StatusTag.module.css';

export type StatusTone = 'neutral' | 'active' | 'warning' | 'danger' | 'system';

export function StatusTag({
  tone = 'neutral',
  children,
}: {
  readonly tone?: StatusTone;
  readonly children: ReactNode;
}) {
  return (
    <span className={styles.tag} data-tone={tone}>
      {children}
    </span>
  );
}
