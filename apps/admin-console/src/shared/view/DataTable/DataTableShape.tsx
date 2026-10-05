import type { ReactNode } from 'react';
import styles from '#/shared/view/DataTable/DataTable.module.css';

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === 'string').join(' ');
}

export interface ShapeColumn {
  header: string;
  secondary?: boolean;
}

// The table's real header and rows with `cell` in every body cell, so a
// placeholder drops columns and stacks at the widths the table does.
export function DataTableShape({
  columns,
  rows,
  cell,
}: {
  columns: readonly ShapeColumn[];
  rows: number;
  cell: ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <table className={styles.table}>
        <thead className={styles.head}>
          <tr>
            {columns.map((column, at) => (
              <th
                key={at}
                className={classes(styles.column, column.secondary === true && styles.secondary)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={styles.body}>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} className={styles.row}>
              {columns.map((column, at) => (
                <td
                  key={at}
                  className={classes(styles.cell, column.secondary === true && styles.secondary)}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
