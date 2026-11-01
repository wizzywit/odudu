import type { ReactNode } from 'react';
import type { RecordView } from '#/shared/service/record';
import type { Crumb } from '#/shared/view/Breadcrumb';
import { Button } from '#/shared/view/Button';
import { EmptyState } from '#/shared/view/EmptyState';
import { ReadOnlyFields } from '#/shared/view/Field';
import { LoadFailed } from '#/shared/view/LoadFailed';
import { PageHeader } from '#/shared/view/PageHeader';
import { RecordSkeleton } from '#/shared/view/Skeleton';
import { Tabs, type TabItem } from '#/shared/view/Tabs';
import styles from '#/shared/view/RecordPage/RecordPage.module.css';

// What each tab of a record page is given: the record under its own name, the
// ETag it was read with, and whether it has since been found deleted.
export type RecordPanelProps<Key extends string, R> = {
  tenant: string;
  etag: string;
  gone: boolean;
} & Record<Key, R>;

// A record is a page with its own address: the tab is part of it, so a tab
// change is asked for, and the unsaved-changes guard answers first.
export function RecordPage({
  record,
  breadcrumb,
  kicker,
  title,
  status,
  description,
  actions,
  noun,
  label,
  banner,
  tabs,
  tab,
  onTabChange,
  viewOnly,
  readOnly: readOnlyChoice,
}: {
  record: RecordView;
  // Up to the list the record sits in, ending with the record itself.
  breadcrumb?: readonly Crumb[];
  // In place of a breadcrumb, for a page that is an area of its own.
  kicker?: ReactNode;
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // What the record is, in running text: "client", "subject".
  noun: string;
  // Names the tab list: "Client sections".
  label: string;
  // Above the tabs, once the record is shown, for what belongs to every tab.
  banner?: ReactNode;
  tabs: readonly TabItem[];
  tab: string;
  onTabChange: (id: string) => void;
  // The one line saying what the caller may not change.
  viewOnly?: ReactNode;
  // Every field in the tabs shows as text; by default, whenever the line is given.
  readOnly?: boolean;
}) {
  const readOnly = readOnlyChoice ?? viewOnly !== undefined;
  const head = (ready: boolean) => (
    <PageHeader
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
      {...(kicker === undefined ? {} : { kicker })}
      title={title}
      {...(ready && status !== undefined ? { status } : {})}
      {...(description === undefined ? {} : { description })}
      {...(ready && actions !== undefined ? { actions } : {})}
    />
  );
  switch (record.status) {
    case 'loading':
      return (
        <>
          {head(false)}
          <RecordSkeleton label={`Loading ${noun}`} tabs={tabs.map((t) => t.label)} title={false} />
        </>
      );
    case 'missing':
      return (
        <>
          {head(false)}
          <EmptyState variant="nothing-matches" title={`No such ${noun}`}>
            It may have been deleted, or the address may be wrong.
          </EmptyState>
        </>
      );
    case 'failed':
      return (
        <>
          {head(false)}
          <LoadFailed title={`This ${noun} could not be loaded`} retry={record.retry} />
        </>
      );
    case 'ready':
      return (
        <>
          {head(true)}
          <div className={styles.updated}>
            {/* Only the sentences are announced; the buttons sit beside them. */}
            <div role="status" aria-label="Record changes" className={styles.messages}>
              {record.refreshFailed ? (
                <p className={styles.notice}>
                  {record.gone
                    ? `This ${noun} was deleted since you opened it. Your edits are still shown, but cannot be saved.`
                    : `Could not check this ${noun} for changes. What you see may be out of date; your edits are kept.`}
                </p>
              ) : null}
              {record.updated ? (
                <p className={styles.notice}>
                  <strong>Updated since you opened it.</strong> Fields you have not changed show the
                  new values; fields you changed keep yours.
                </p>
              ) : null}
            </div>
            {(record.refreshFailed && !record.gone) || record.updated ? (
              <div className={styles.actions}>
                {record.refreshFailed && !record.gone ? (
                  <Button size="small" variant="quiet" onPress={record.retry}>
                    Check again
                  </Button>
                ) : null}
                {record.updated ? (
                  <Button size="small" variant="quiet" onPress={record.acknowledge}>
                    Dismiss
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {viewOnly}
          {banner}
          <ReadOnlyFields when={readOnly}>
            <Tabs label={label} tabs={tabs} selectedKey={tab} onSelectionChange={onTabChange} />
          </ReadOnlyFields>
        </>
      );
  }
}
