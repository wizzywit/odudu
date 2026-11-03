import type { MailRow } from '#/pages/email/services/mailDelivery';
import {
  useMailDelivery,
  type MailDelivery as Delivery,
} from '#/pages/email/use-cases/useMailDelivery';
import { Button } from '#/shared/ui/Button';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore, LoadMoreFailed } from '#/shared/ui/LoadMore';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/email/ui/MailDelivery/MailDelivery.module.css';

function Outcome({ outcome }: { outcome: MailRow['outcome'] }) {
  if (outcome.at === null) return <span>{outcome.text}</span>;
  return (
    <span className={styles.outcome}>
      {outcome.text}
      <Timestamp value={outcome.at} />
    </span>
  );
}

function columns(page: Delivery): readonly Column<MailRow>[] {
  const header = page.words.columns;
  return [
    { id: 'to', header: header.to, isRowHeader: true, cell: (message) => message.to },
    { id: 'subject', header: header.subject, secondary: true, cell: (message) => message.subject },
    {
      id: 'status',
      header: header.status,
      cell: (message) => <StatusTag tone={message.tone}>{message.status}</StatusTag>,
    },
    { id: 'attempts', header: header.attempts, cell: (message) => message.attempts },
    {
      id: 'last_error',
      header: header.lastError,
      secondary: true,
      cell: (message) => message.lastError,
    },
    {
      id: 'created_at',
      header: header.queued,
      secondary: true,
      cell: (message) => <Timestamp value={message.queuedAt} />,
    },
    {
      id: 'outcome',
      header: header.outcome,
      secondary: true,
      cell: (message) => <Outcome outcome={message.outcome} />,
    },
  ];
}

function Rows({ page }: { page: Delivery }) {
  const { list, words } = page;
  const cols = columns(page);
  return (
    <ListGate
      list={{ status: list.status, retry: list.refresh }}
      loading={<TableSkeleton label={words.loading} columns={cols} rows={2} />}
      refused={{ capability: 'manage-tenant', noun: words.heading }}
      failed={words.failed}
    >
      {() =>
        list.rows.length === 0 ? (
          <p className={recordTab.rule}>{words.nothing}</p>
        ) : (
          <>
            {page.oldestWaiting === null ? null : (
              <p className={recordTab.rule}>
                {words.oldestWaiting} <Timestamp value={page.oldestWaiting} />
              </p>
            )}
            <DataTable
              label={page.tableLabel}
              columns={cols}
              rows={list.rows}
              rowKey={(message) => message.id}
            />
            {page.masked ? <p className={recordTab.rule}>{words.masked}</p> : null}
            {list.more ? (
              <div className={recordTab.actions}>
                <LoadMore
                  noun={words.noun}
                  loading={list.loadingMore}
                  limited={list.loadLimited}
                  onPress={list.loadMore}
                />
              </div>
            ) : null}
            {list.loadMoreFailed ? <LoadMoreFailed noun={words.noun} /> : null}
          </>
        )
      }
    </ListGate>
  );
}

export function MailDelivery({ tenant }: { tenant: string }) {
  const page = useMailDelivery(tenant);
  const { words } = page;
  return (
    <Panel title={words.heading}>
      <p className={recordTab.rule}>{words.rule}</p>
      <div className={styles.controls}>
        <SelectField
          label={words.filter}
          options={words.statuses}
          value={page.status}
          onChange={page.setStatus}
        />
        <Button onPress={page.list.refresh}>{words.refresh}</Button>
      </div>
      <Rows page={page} />
    </Panel>
  );
}
