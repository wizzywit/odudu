import type { ReactNode } from 'react';
import type { RecordView } from '#/shared/service/record.ts';
import type { Crumb } from '#/shared/view/Breadcrumb.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { RecordSkeleton } from '#/shared/view/Skeleton.tsx';
import { Tabs, type TabItem } from '#/shared/view/Tabs.tsx';
import styles from '#/shared/view/RecordPage.module.css';

// A record is a page with its own address: the tab is part of it, so a tab
// change is asked for, and the unsaved-changes guard answers first.
export function RecordPage({
  record,
  breadcrumb,
  title,
  status,
  description,
  actions,
  noun,
  label,
  tabs,
  tab,
  onTabChange,
  viewOnly,
  readOnly = viewOnly !== undefined,
}: {
  record: RecordView;
  // Up to the list the record sits in, ending with the record itself.
  breadcrumb: readonly Crumb[];
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // What the record is, in running text: "client", "subject".
  noun: string;
  // Names the tab list: "Client sections".
  label: string;
  tabs: readonly TabItem[];
  tab: string;
  onTabChange: (id: string) => void;
  // The one line saying what the caller may not change.
  viewOnly?: ReactNode;
  // Every field in the tabs shows as text; by default, whenever the line is given.
  readOnly?: boolean;
}) {
  const head = (ready: boolean) => (
    <PageHeader
      breadcrumb={breadcrumb}
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
            {`There is no such ${noun} in this tenant. It may have been deleted.`}
          </EmptyState>
        </>
      );
    case 'failed':
      return (
        <>
          {head(false)}
          <EmptyState
            variant="failed"
            title={`This ${noun} could not be loaded`}
            action={<Button onPress={record.retry}>Try again</Button>}
          >
            The gateway did not answer, or answered with an error.
          </EmptyState>
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
          <ReadOnlyFields when={readOnly}>
            <Tabs label={label} tabs={tabs} selectedKey={tab} onSelectionChange={onTabChange} />
          </ReadOnlyFields>
        </>
      );
  }
}
