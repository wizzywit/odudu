import styles from '#/shared/view/Skeleton.module.css';

export function Skeleton({
  label,
  lines = 3,
}: {
  readonly label: string;
  readonly lines?: number;
}) {
  return (
    <div role="status" aria-busy="true" className={styles.skeleton}>
      <span className={styles.label}>{label}</span>
      <div aria-hidden="true" className={styles.bars}>
        {Array.from({ length: lines }, (_, line) => (
          <span key={line} className={styles.bar} />
        ))}
      </div>
    </div>
  );
}
