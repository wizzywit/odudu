import { Link } from 'react-aria-components';
import styles from '#/shared/view/ContextBar/ContextBar.module.css';

// The bar never collapses, so its way back is there at every width.
export function ContextBar({ tenant, backHref }: { tenant: string; backHref: string }) {
  return (
    <div role="region" aria-label="System authority" className={styles.bar}>
      <span className={styles.label} aria-hidden="true">
        System
      </span>
      <p className={styles.text}>
        Acting in <strong>{tenant}</strong> with system authority
      </p>
      <Link href={backHref} className={styles.back ?? ''}>
        Back to system
      </Link>
    </div>
  );
}
