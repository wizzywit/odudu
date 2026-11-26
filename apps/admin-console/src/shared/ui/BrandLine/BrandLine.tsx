import type { ReactNode } from 'react';
import styles from '#/shared/ui/BrandLine/BrandLine.module.css';

// The staff, drawn from the same three shapes as packages/instrument/src/mark.svg
// (tests/lint/brand-assets.test.ts holds the two to each other).
function Mark() {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="6" r="4" />
      <path d="M16 10V30" />
      <path d="M12 14H20" />
    </svg>
  );
}

// Decorative: the name beside it is what a screen reader reads. `single` keeps
// the name on one line and cuts it with an ellipsis where the bar has no room.
export function BrandLine({ children, single = false }: { children: ReactNode; single?: boolean }) {
  return (
    <span className={styles.line} data-single={single || undefined}>
      <Mark />
      <span className={styles.name}>{children}</span>
    </span>
  );
}
