import { formatDuration } from '#/shared/service/format.ts';
import styles from '#/shared/view/Duration/Duration.module.css';

export function Duration({ seconds }: { seconds: number }) {
  return <span className={styles.duration}>{formatDuration(seconds)}</span>;
}
