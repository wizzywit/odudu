import { VisuallyHidden } from 'react-aria-components';
import styles from '#/widgets/assistant-panel/ui/Countdown/Countdown.module.css';

// The time left to decide, written as it is and never announced as it
// changes. The live region beside it holds words only at one minute and at
// expiry, so a screen reader is told twice and not every second.
export function Countdown({
  text,
  announcement,
  expired,
}: {
  text: string;
  announcement: string;
  expired: boolean;
}) {
  return (
    <span className={styles.countdown} data-expired={expired || undefined}>
      <span>{text}</span>
      <VisuallyHidden>
        <span role="status">{announcement}</span>
      </VisuallyHidden>
    </span>
  );
}
