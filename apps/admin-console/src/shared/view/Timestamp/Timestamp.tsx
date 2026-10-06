import { VisuallyHidden } from 'react-aria-components';
import { formatAbsolute, formatRelative } from '#/shared/service/format.ts';
import { useNow } from '#/shared/usecase/useNow.ts';
import styles from '#/shared/view/Timestamp/Timestamp.module.css';

// Fresh to within half a minute, finer than the minutes the label mostly shows.
const REFRESH_MS = 30_000;

export function Timestamp({ value, now }: { value: string | Date; now?: Date }) {
  const clock = useNow(REFRESH_MS);
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return <span>{String(value)}</span>;
  return (
    <time className={styles.time} dateTime={instant.toISOString()}>
      <span>{formatRelative(instant, now ?? clock)}</span>
      <VisuallyHidden elementType="span">{' · '}</VisuallyHidden>
      <span className={styles.absolute}>{formatAbsolute(instant)}</span>
    </time>
  );
}
