import { createContext, use, type ReactNode } from 'react';
import { DataTableShape, type ShapeColumn } from '#/shared/view/DataTable';
import styles from '#/shared/view/Skeleton/Skeleton.module.css';

// One status line says what is loading; the shape of what will load is drawn
// beside it and hidden, so it is seen and never read out.
type Shape = 'lines' | 'table' | 'record' | 'form' | 'terms' | 'list' | 'panels';

const Announces = createContext(true);

// Placeholders inside say nothing themselves: a live region that stays
// mounted around them already does, and a second one would read it twice.
export function QuietSkeletons({ children }: { children: ReactNode }) {
  return <Announces value={false}>{children}</Announces>;
}

function Frame({ label, shape, children }: { label: string; shape: Shape; children: ReactNode }) {
  const announces = use(Announces);
  return (
    <div role={announces ? 'status' : undefined} className={styles.skeleton}>
      <span aria-hidden={announces ? undefined : true} className={styles.label}>
        {label}
      </span>
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

export type SkeletonColumn = ShapeColumn;

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
      <DataTableShape columns={columns} rows={rows} cell={<SkeletonBar />} />
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
      <RecordShape tabs={tabs} title={title} />
    </Frame>
  );
}

function RecordShape({ tabs, title }: { tabs: readonly string[]; title: boolean }) {
  return (
    <>
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
    </>
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

export type PageShape = 'overview' | 'list' | 'record' | 'form' | 'page';

const BLANK_COLUMNS: readonly SkeletonColumn[] = [0, 1, 2, 3].map(() => ({ header: '' }));

// The whole body of a page whose address is known and whose content is not:
// one status line over the shape the page will fill, whichever it is.
export function PageSkeleton({ label, shape }: { label: string; shape: PageShape }) {
  if (shape === 'overview') {
    return (
      <Frame label={label} shape="panels">
        <div className={styles.panels}>
          {times(3).map((panel) => (
            <div key={panel} className={styles.panel} data-part="panel">
              <span className={styles.bar} data-size="heading" />
              <span className={styles.bar} data-size="line" />
              <span className={styles.bar} data-size="line" />
            </div>
          ))}
        </div>
      </Frame>
    );
  }
  if (shape === 'list') {
    return (
      <Frame label={label} shape="table">
        <DataTableShape columns={BLANK_COLUMNS} rows={5} cell={<SkeletonBar />} />
      </Frame>
    );
  }
  if (shape === 'record') {
    return (
      <Frame label={label} shape="record">
        <RecordShape tabs={['General', 'Activity']} title />
      </Frame>
    );
  }
  if (shape === 'form') return <FormSkeleton label={label} fields={4} />;
  return <Skeleton label={label} lines={4} />;
}
