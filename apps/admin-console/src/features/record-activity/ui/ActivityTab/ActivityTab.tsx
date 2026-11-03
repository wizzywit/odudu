import type { ActivityWords } from '#/features/record-activity/services/activityWords';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
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
  words,
  now,
}: {
  list: ResourceListState<AuditEvent>;
  words: ActivityWords;
  now?: Date;
}) {
  return (
    <ListGate
      list={list}
      loading={<TableSkeleton label={words.loading} columns={auditColumns({ now })} />}
      refused={{ capability: 'view-audit', noun: words.refusedNoun }}
      failed={words.failed}
    >
      {() =>
        list.rows.length === 0 ? (
          <EmptyState variant="nothing-yet" title={words.emptyTitle}>
            {words.emptyText}
          </EmptyState>
        ) : (
          <div className={styles.activity}>
            <p className={styles.note}>{words.note}</p>
            <AuditTable
              label={words.tableLabel}
              rows={list.rows}
              {...(now === undefined ? {} : { now })}
            />
            <Pager label={words.pagerLabel} list={list} />
            {list.loadMoreFailed ? <LoadMoreFailed noun={words.moreFailedNoun} /> : null}
          </div>
        )
      }
    </ListGate>
  );
}
