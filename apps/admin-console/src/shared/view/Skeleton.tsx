import styles from '#/shared/view/Skeleton.module.css';

export function Skeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" className={styles.skeleton}>
      <span className={styles.label}>{label}</span>
      <div aria-hidden="true" className={styles.bars}>
        {Array.from({ length: lines }, (_, line) => (
          <span key={line} className={styles.bar} />
        ))}
      </div>
    </div>
  );
}
