import type { ReactNode } from 'react';
import styles from '#/shared/view/VisuallyHidden/VisuallyHidden.module.css';

// Present for a screen reader and absent from the page. With `role="status"`
// it is a live region, which stays mounted while its text changes.
export function VisuallyHidden({ role, children }: { role?: 'status'; children: ReactNode }) {
  return (
    <span role={role} className={styles.hidden}>
      {children}
    </span>
  );
}
