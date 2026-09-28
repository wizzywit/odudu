import type { ReactNode } from 'react';
import {
  Cell,
  Column as AriaColumn,
  Row,
  Table,
  TableBody,
  TableHeader,
  type Key,
} from 'react-aria-components';
import styles from '#/shared/view/DataTable.module.css';

export interface Column<T> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  readonly isRowHeader?: boolean;
  // Dropped while the shell is narrower than 1024 px, where fewer columns fit.
  readonly secondary?: boolean;
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === 'string').join(' ');
}

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  onRowAction,
  empty,
}: {
  readonly label: string;
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly onRowAction?: (id: string) => void;
  readonly empty?: ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <Table
        aria-label={label}
        className={styles.table ?? ''}
        {...(onRowAction === undefined
          ? {}
          : {
              onRowAction: (key: Key) => {
                onRowAction(String(key));
              },
            })}
      >
        <TableHeader className={styles.head ?? ''}>
          {columns.map((column) => (
            <AriaColumn
              key={column.id}
              id={column.id}
              isRowHeader={column.isRowHeader ?? false}
              className={classes(styles.column, column.secondary === true && styles.secondary)}
            >
              {column.header}
            </AriaColumn>
          ))}
        </TableHeader>
        <TableBody
          className={styles.body ?? ''}
          {...(empty === undefined ? {} : { renderEmptyState: () => empty })}
        >
          {rows.map((row) => {
            const id = rowKey(row);
            return (
              <Row
                key={id}
                id={id}
                className={classes(styles.row, onRowAction !== undefined && styles.actionable)}
              >
                {columns.map((column) => (
                  <Cell
                    key={column.id}
                    className={classes(styles.cell, column.secondary === true && styles.secondary)}
                  >
                    <span className={styles.cellLabel} aria-hidden="true">
                      {column.header}
                    </span>
                    <span className={styles.cellValue}>{column.cell(row)}</span>
                  </Cell>
                ))}
              </Row>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
