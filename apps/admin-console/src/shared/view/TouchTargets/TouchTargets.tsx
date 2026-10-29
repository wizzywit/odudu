import type { ReactNode } from 'react';
import styles from '#/shared/view/TouchTargets/TouchTargets.module.css';

// Around a page that is used by finger as much as by pointer: on a touch
// screen or a narrow one its controls grow to 44px and its inputs to 16px,
// below which a phone's browser zooms the page when a field takes focus.
export function TouchTargets({ children }: { children: ReactNode }) {
  return <div className={styles.scope}>{children}</div>;
}
