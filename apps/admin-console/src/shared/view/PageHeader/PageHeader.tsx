import type { ReactNode } from 'react';
import { Breadcrumb, type Crumb } from '#/shared/view/Breadcrumb';
import styles from '#/shared/view/PageHeader/PageHeader.module.css';

// A page below a list names its way back with a breadcrumb; a list page
// names its rail group with a kicker instead.
export function PageHeader({
  title,
  kicker,
  breadcrumb,
  status,
  description,
  actions,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  breadcrumb?: readonly Crumb[];
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {breadcrumb === undefined ? null : <Breadcrumb items={breadcrumb} />}
        {kicker === undefined ? null : <p className={styles.kicker}>{kicker}</p>}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {status}
        </div>
        {description === undefined ? null : <p className={styles.description}>{description}</p>}
      </div>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
