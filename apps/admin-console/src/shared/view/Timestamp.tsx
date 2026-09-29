import { VisuallyHidden } from 'react-aria-components';
import { formatAbsolute, formatRelative } from '#/shared/service/format.ts';
import styles from '#/shared/view/Timestamp.module.css';

export function Timestamp({ value, now = new Date() }: { value: string | Date; now?: Date }) {
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return <span>{String(value)}</span>;
  return (
    <time className={styles.time} dateTime={instant.toISOString()}>
      <span>{formatRelative(instant, now)}</span>
      <VisuallyHidden elementType="span">{' · '}</VisuallyHidden>
      <span className={styles.absolute}>{formatAbsolute(instant)}</span>
    </time>
  );
}
