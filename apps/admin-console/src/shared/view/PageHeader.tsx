import type { ReactNode } from 'react';
import styles from '#/shared/view/PageHeader.module.css';

export function PageHeader({
  title,
  kicker,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly kicker?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {kicker === undefined ? null : <p className={styles.kicker}>{kicker}</p>}
        <h1 className={styles.title}>{title}</h1>
        {description === undefined ? null : <p className={styles.description}>{description}</p>}
      </div>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
