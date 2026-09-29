import type { ReactNode } from 'react';
import type { RecordView } from '#/shared/service/record.ts';
import { Button } from '#/shared/view/Button.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import { Tabs, type TabItem } from '#/shared/view/Tabs.tsx';
import styles from '#/shared/view/RecordPage.module.css';

// A record is a page with its own address: the tab is part of it, so a tab
// change is asked for, and the unsaved-changes guard answers first.
export function RecordPage({
  record,
  kicker,
  title,
  description,
  actions,
  noun,
  label,
  tabs,
  tab,
  onTabChange,
}: {
  record: RecordView;
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // What the record is, in running text: "client", "subject".
  noun: string;
  // Names the tab list: "Client sections".
  label: string;
  readonly tabs: readonly TabItem[];
  tab: string;
  onTabChange: (id: string) => void;
}) {
  const head = (withActions: boolean) => (
    <PageHeader
      title={title}
      {...(kicker === undefined ? {} : { kicker })}
      {...(description === undefined ? {} : { description })}
      {...(withActions && actions !== undefined ? { actions } : {})}
    />
  );
  switch (record.status) {
    case 'loading':
      return (
        <>
          {head(false)}
          <Skeleton label={`Loading ${noun}`} lines={5} />
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
          <div role="status" aria-label="Record changes" className={styles.updated}>
            {record.updated ? (
              <p className={styles.notice}>
                <span>
                  <strong>Updated since you opened it.</strong> Fields you have not changed show the
                  new values; fields you changed keep yours.
                </span>
                <Button size="small" variant="quiet" onPress={record.acknowledge}>
                  Dismiss
                </Button>
              </p>
            ) : null}
          </div>
          <Tabs label={label} tabs={tabs} selectedKey={tab} onSelectionChange={onTabChange} />
        </>
      );
  }
}
