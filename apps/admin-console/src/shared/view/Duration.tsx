import { formatDuration } from '#/shared/service/format.ts';
import styles from '#/shared/view/Duration.module.css';

export function Duration({ seconds }: { readonly seconds: number }) {
  return <span className={styles.duration}>{formatDuration(seconds)}</span>;
}
