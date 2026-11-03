import type { ReactElement } from 'react';
import styles from '@site/src/features/landing/ui/Chip/Chip.module.css';

interface Props {
  children: string;
}

export function Chip({ children }: Props): ReactElement {
  return (
    <span className={styles.chip} data-chip="">
      {children}
    </span>
  );
}
