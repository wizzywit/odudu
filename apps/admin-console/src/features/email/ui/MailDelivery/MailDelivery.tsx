import type { MailMessage } from '@odudu/contracts/admin';
import {
  mailOutcome,
  mailTone,
  MAIL_HEADING,
  MAIL_RULE,
  MAIL_STATUS_OPTIONS,
  MASKED_NOTE,
  NO_MAIL,
} from '#/features/email/services';
import {
  useMailDelivery,
  type MailDelivery as Delivery,
} from '#/features/email/use-cases/useMailDelivery';
import { attemptsText } from '#/shared/services/format';
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
import styles from '#/features/email/ui/MailDelivery/MailDelivery.module.css';

function Outcome({ message }: { message: MailMessage }) {
  const outcome = mailOutcome(message);
  if (outcome.kind === 'given-up') return <span>gave up</span>;
  return (
    <span className={styles.outcome}>
      {outcome.kind === 'sent' ? 'sent' : 'next try'}
      <Timestamp value={outcome.at} />
    </span>
  );
}

const COLUMNS: readonly Column<MailMessage>[] = [
  { id: 'to', header: 'Recipient', isRowHeader: true, cell: (message) => message.to },
  { id: 'subject', header: 'Subject', secondary: true, cell: (message) => message.subject },
  {
    id: 'status',
    header: 'Status',
    cell: (message) => <StatusTag tone={mailTone(message.status)}>{message.status}</StatusTag>,
  },
  { id: 'attempts', header: 'Attempts', cell: (message) => attemptsText(message.attempts) },
  {
    id: 'last_error',
    header: 'Last error',
    secondary: true,
    cell: (message) => message.last_error ?? '—',
  },
  {
    id: 'created_at',
    header: 'Queued',
    secondary: true,
    cell: (message) => <Timestamp value={message.created_at} />,
  },
  {
    id: 'outcome',
    header: 'Outcome',
    secondary: true,
    cell: (message) => <Outcome message={message} />,
  },
];

function Rows({ tenant, page }: { tenant: string; page: Delivery }) {
  const { list } = page;
  return (
    <ListGate
      list={{ status: list.status, retry: list.refresh }}
      loading={<TableSkeleton label="Loading messages" columns={COLUMNS} rows={2} />}
      refused={{ capability: 'manage-tenant', noun: MAIL_HEADING }}
      failed="The mail could not be loaded"
    >
      {() =>
        list.rows.length === 0 ? (
          <p className={recordTab.rule}>{NO_MAIL}</p>
        ) : (
          <>
            {page.oldestWaiting === null ? null : (
              <p className={recordTab.rule}>
                Oldest message still waiting was queued <Timestamp value={page.oldestWaiting} />
              </p>
            )}
            <DataTable
              label={`Mail of ${tenant}`}
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(message) => message.id}
            />
            {page.masked ? <p className={recordTab.rule}>{MASKED_NOTE}</p> : null}
            {list.more ? (
              <div className={recordTab.actions}>
                <LoadMore
                  noun="messages"
                  loading={list.loadingMore}
                  limited={list.loadLimited}
                  onPress={list.loadMore}
                />
              </div>
            ) : null}
            {list.loadMoreFailed ? <LoadMoreFailed noun="messages" /> : null}
          </>
        )
      }
    </ListGate>
  );
}

export function MailDelivery({ tenant }: { tenant: string }) {
  const page = useMailDelivery(tenant);
  return (
    <Panel title={MAIL_HEADING}>
      <p className={recordTab.rule}>{MAIL_RULE}</p>
      <div className={styles.controls}>
        <SelectField
          label="Show"
          options={MAIL_STATUS_OPTIONS}
          value={page.status}
          onChange={page.setStatus}
        />
        <Button onPress={page.list.refresh}>Refresh</Button>
      </div>
      <Rows tenant={tenant} page={page} />
    </Panel>
  );
}
