import styles from '#/shared/view/ContextBar.module.css';

export function ContextBar({ tenant }: { tenant: string }) {
  return (
    <div role="region" aria-label="System authority" className={styles.bar}>
      <span className={styles.label} aria-hidden="true">
        System
      </span>
      <p>
        Acting in <strong>{tenant}</strong> with system authority
      </p>
    </div>
  );
}
