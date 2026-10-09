import { useId, type ReactNode } from 'react';
import styles from '#/features/overview/view/Panel/Panel.module.css';

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <header className={styles.header}>
        <h2 id={heading} className={styles.title}>
          {title}
        </h2>
        {action === undefined ? null : <div className={styles.action}>{action}</div>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
