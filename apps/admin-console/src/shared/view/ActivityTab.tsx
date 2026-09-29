import type { AuditEvent } from '@odudu/contracts/admin';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { TableSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag, type StatusTone } from '#/shared/view/StatusTag.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import styles from '#/shared/view/ActivityTab.module.css';

const TONES: Record<AuditEvent['outcome'], StatusTone> = {
  allowed: 'active',
  refused: 'warning',
  failed: 'danger',
};

function columns(now: Date | undefined): readonly Column<AuditEvent>[] {
  return [
    {
      id: 'when',
      header: 'When',
      cell: (event) => (
        <Timestamp value={event.occurred_at} {...(now === undefined ? {} : { now })} />
      ),
      isRowHeader: true,
    },
    { id: 'action', header: 'Action', cell: (event) => <code>{event.action}</code> },
    {
      id: 'outcome',
      header: 'Outcome',
      cell: (event) => <StatusTag tone={TONES[event.outcome]}>{event.outcome}</StatusTag>,
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (event) =>
        event.actor_subject_id === null ? (
          <span className={styles.none}>no subject</span>
        ) : (
          <CopyValue label="actor subject id" value={event.actor_subject_id} short />
        ),
    },
    {
      id: 'correlation',
      header: 'Correlation id',
      cell: (event) =>
        event.request_id === null ? (
          <span className={styles.none}>none sent</span>
        ) : (
          <CopyValue label="correlation id" value={event.request_id} short />
        ),
    },
  ];
}

// The audit trail narrowed to one record: the same rows the Audit trail
// shows, never a second account of them.
export function ActivityTab({
  list,
  noun,
  now,
}: {
  list: ResourceListState<AuditEvent>;
  // What the record is: "client".
  noun: string;
  now?: Date;
}) {
  switch (list.status) {
    case 'loading':
      return <TableSkeleton label="Loading activity" columns={columns(now)} />;
    case 'refused':
      return <CapabilityNote capability="view-audit">Activity</CapabilityNote>;
    case 'failed':
      return (
        <EmptyState
          variant="failed"
          title="Activity could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
    case 'ready':
      break;
  }
  if (list.rows.length === 0) {
    return (
      <EmptyState variant="nothing-yet" title={`No activity on this ${noun} yet`}>
        Every change made to it, and every change refused, is listed here.
      </EmptyState>
    );
  }
  return (
    <div className={styles.activity}>
      <p className={styles.note}>
        A correlation id links rows written for one request. The caller can set it, so it is a
        correlation, not evidence.
      </p>
      <DataTable
        label={`Activity on this ${noun}`}
        columns={columns(now)}
        rows={list.rows}
        rowKey={(event) => event.id}
      />
      <Pager
        label="Activity"
        trail={list.trail}
        next={list.next}
        onTrailChange={list.setTrail}
        onLoadMore={list.loadMore}
        loadingMore={list.loadingMore}
      />
      {list.loadMoreFailed ? (
        <p role="alert" className={styles.failed}>
          More activity could not be loaded. Load more tries again.
        </p>
      ) : null}
    </div>
  );
}
