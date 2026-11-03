import type { ReactNode } from 'react';
import styles from '#/shared/ui/StatusTag/StatusTag.module.css';

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

// Whether a record may be used, said in words and a tone, wherever one is listed.
export function EnabledTag({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <StatusTag tone="active">enabled</StatusTag>
  ) : (
    <StatusTag tone="danger">disabled</StatusTag>
  );
}

const OUTCOME_TONES = { allowed: 'active', refused: 'warning', failed: 'danger' } as const;

// What an audit event came to, in words and a tone.
export function OutcomeTag({ outcome }: { outcome: keyof typeof OUTCOME_TONES }) {
  return <StatusTag tone={OUTCOME_TONES[outcome]}>{outcome}</StatusTag>;
}
