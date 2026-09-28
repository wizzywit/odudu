import { useId, type ReactNode } from 'react';
import styles from '#/shared/view/EmptyState.module.css';

export type EmptyVariant = 'nothing-yet' | 'nothing-matches' | 'failed';

const KICKER: Record<EmptyVariant, string> = {
  'nothing-yet': 'Nothing yet',
  'nothing-matches': 'No matches',
  failed: 'Failed to load',
};

export function EmptyState({
  variant,
  title,
  children,
  action,
}: {
  readonly variant: EmptyVariant;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  const heading = useId();
  return (
    <section
      aria-labelledby={heading}
      className={styles.empty}
      data-variant={variant}
      {...(variant === 'failed' ? { role: 'alert' } : {})}
    >
      <p className={styles.kicker}>{KICKER[variant]}</p>
      <h2 id={heading} className={styles.title}>
        {title}
      </h2>
      {children === undefined ? null : <p className={styles.body}>{children}</p>}
      {action === undefined ? null : <div className={styles.action}>{action}</div>}
    </section>
  );
}
