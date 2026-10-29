import type { ReactNode } from 'react';
import styles from '#/shared/view/TouchTargets/TouchTargets.module.css';

// Around a page that is used by finger as much as by pointer: on a touch
// screen or a narrow one its controls grow to 44px and its inputs to 16px,
// below which a phone's browser zooms the page when a field takes focus.
// The sizes are set on the body while it is shown (global.css), so what it
// opens in a portal has them too.
export function TouchTargets({ children }: { children: ReactNode }) {
  return (
    <div className={styles.scope} data-touch-scope>
      {children}
    </div>
  );
}
