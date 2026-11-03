import { formatDuration } from '#/shared/lib/services/format';
import styles from '#/shared/ui/Duration/Duration.module.css';

export function Duration({ seconds }: { seconds: number }) {
  return <span className={styles.duration}>{formatDuration(seconds)}</span>;
}
