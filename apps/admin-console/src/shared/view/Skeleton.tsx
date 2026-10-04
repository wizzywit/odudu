import type { ReactNode } from 'react';
import table from '#/shared/view/DataTable.module.css';
import styles from '#/shared/view/Skeleton.module.css';

// One status line says what is loading; the shape of what will load is drawn
// beside it and hidden, so it is seen and never read out.
type Shape = 'lines' | 'table' | 'record' | 'form' | 'terms' | 'list';

function Frame({ label, shape, children }: { label: string; shape: Shape; children: ReactNode }) {
  return (
    <div role="status" className={styles.skeleton}>
      <span className={styles.label}>{label}</span>
      <div aria-hidden="true" className={styles.shape} data-shape={shape}>
        {children}
      </div>
    </div>
  );
}

function times(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function SkeletonBar({ size = 'value' }: { size?: 'value' | 'label' | 'title' | 'field' }) {
  return <span aria-hidden="true" className={styles.bar} data-size={size} />;
}

// For what has no shape yet: a page whose chunk or access is still coming.
export function Skeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <Frame label={label} shape="lines">
      {times(lines).map((line) => (
        <span key={line} className={styles.bar} data-size="line" />
      ))}
    </Frame>
  );
}

export interface SkeletonColumn {
  header: string;
  secondary?: boolean;
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === 'string').join(' ');
}

// The table's real header over placeholder rows, so its columns drop out and
// stack at the widths the table's own do.
export function TableSkeleton({
  label,
  columns,
  rows = 5,
}: {
  label: string;
  columns: readonly SkeletonColumn[];
  rows?: number;
}) {
  return (
    <Frame label={label} shape="table">
      <div className={table.frame}>
        <table className={table.table}>
          <thead className={table.head}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={classes(table.column, column.secondary === true && table.secondary)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={table.body}>
            {times(rows).map((row) => (
              <tr key={row} className={table.row}>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={classes(table.cell, column.secondary === true && table.secondary)}
                  >
                    <span className={styles.bar} data-size="value" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

function Fields({ count }: { count: number }) {
  return times(count).map((field) => (
    <div key={field} className={styles.field} data-part="field">
      <span className={styles.bar} data-size="label" />
      <span className={styles.bar} data-size="field" />
    </div>
  ));
}

export function RecordSkeleton({
  label,
  tabs,
  title = true,
}: {
  label: string;
  tabs: readonly string[];
  // False beneath a page header that already draws the title.
  title?: boolean;
}) {
  return (
    <Frame label={label} shape="record">
      {title ? (
        <div className={styles.title} data-part="title">
          <span className={styles.bar} data-size="title" />
          <span className={styles.bar} data-size="tag" />
        </div>
      ) : null}
      <div className={styles.tabs} data-part="tabs">
        {tabs.map((tab) => (
          <span key={tab} className={styles.tab}>
            {tab}
          </span>
        ))}
      </div>
      {times(2).map((section) => (
        <div key={section} className={styles.section} data-part="section">
          <span className={styles.bar} data-size="heading" />
          <Fields count={3} />
        </div>
      ))}
    </Frame>
  );
}

export function FormSkeleton({ label, fields = 3 }: { label: string; fields?: number }) {
  return (
    <Frame label={label} shape="form">
      <div className={styles.form}>
        <Fields count={fields} />
      </div>
    </Frame>
  );
}

export function TermsSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <Frame label={label} shape="terms">
      <div className={styles.terms}>
        {times(rows).map((row) => (
          <div key={row} className={styles.term} data-part="term">
            <span className={styles.bar} data-size="label" />
            <span className={styles.bar} data-size="value" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function ListSkeleton({ label, items = 3 }: { label: string; items?: number }) {
  return (
    <Frame label={label} shape="list">
      <div className={styles.list}>
        {times(items).map((item) => (
          <div key={item} className={styles.item} data-part="item">
            <span className={styles.bar} data-size="label" />
            <span className={styles.bar} data-size="value" />
          </div>
        ))}
      </div>
    </Frame>
  );
}
