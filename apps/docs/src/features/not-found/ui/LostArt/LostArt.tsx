import type { ReactElement } from 'react';
import styles from '@site/src/features/not-found/ui/LostArt/LostArt.module.css';

// Decorative: the heading and the links beside it carry the meaning. The same
// drawing as packages/instrument/src/lost.svg (tests/lint/lost-art.test.ts
// holds the two equal); the timing is in the stylesheet.
export function LostArt(): ReactElement {
  return (
    <svg
      className={styles.lost}
      viewBox="0 0 240 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g>
        <rect x="6" y="26" width="44" height="36" rx="4" />
        <path d="M6 36H50" />
      </g>
      <path className={styles.routeA} pathLength="1" d="M54 46C80 46 94 70 122 70" />
      <path className={styles.routeB} pathLength="1" d="M146 70C170 70 182 50 200 50" />
      <path className={styles.bridge} d="M122 70H146" />
      <g className={styles.badge}>
        <circle cx="134" cy="70" r="10" />
        <path d="M130.5 66.5A3.5 3.5 0 1 1 135.5 69.7C134.3 70.3 134 71 134 72" />
        <path d="M134 75.5V75.6" />
      </g>
      <g className={styles.staff}>
        <circle cx="214" cy="26" r="7" />
        <path d="M214 33V84" />
        <path d="M206 43H222" />
      </g>
    </svg>
  );
}
