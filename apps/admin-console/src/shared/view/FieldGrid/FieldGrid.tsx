import type { ReactNode } from 'react';
import styles from '#/shared/view/FieldGrid/FieldGrid.module.css';

// Fields in columns that follow the grid's own width: three when wide, two,
// then one. A cell names its span rather than leaving the grid to pack it.
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.grid}>{children}</div>
    </div>
  );
}

export type CellSpan = 'wide' | 'full';

export function GridCell({ span, children }: { span?: CellSpan; children: ReactNode }) {
  return (
    <div className={styles.cell} data-cell data-span={span}>
      {children}
    </div>
  );
}
