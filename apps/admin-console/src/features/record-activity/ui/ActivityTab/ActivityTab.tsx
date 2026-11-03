import type { ResourceListState } from '#/shared/services/resourceList';
import { auditColumns, AuditTable, type AuditEvent } from '#/entities/audit-event';
import { EmptyState } from '#/shared/ui/EmptyState';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMoreFailed } from '#/shared/ui/LoadMore';
import { Pager } from '#/shared/ui/Pager';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import styles from '#/features/record-activity/ui/ActivityTab/ActivityTab.module.css';

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
  return (
    <ListGate
      list={list}
      loading={<TableSkeleton label="Loading activity" columns={auditColumns({ now })} />}
      refused={{ capability: 'view-audit', noun: 'Activity' }}
      failed="Activity could not be loaded"
    >
      {() =>
        list.rows.length === 0 ? (
          <EmptyState variant="nothing-yet" title={`No activity on this ${noun} yet`}>
            Every change made to it, and every change refused, is listed here.
          </EmptyState>
        ) : (
          <div className={styles.activity}>
            <p className={styles.note}>
              A correlation id links rows written for one request. The caller can set it, so it is a
              correlation, not evidence.
            </p>
            <AuditTable
              label={`Activity on this ${noun}`}
              rows={list.rows}
              {...(now === undefined ? {} : { now })}
            />
            <Pager label="Activity" list={list} />
            {list.loadMoreFailed ? <LoadMoreFailed noun="activity" /> : null}
          </div>
        )
      }
    </ListGate>
  );
}
