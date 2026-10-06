import type { Client, TenantSession } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  NO_SESSIONS,
  REVOKE_HEADING,
  REVOKE_RULE,
  SESSIONS_CAPABILITY,
  SESSIONS_NOUN,
  SESSIONS_RULE,
  type Reach,
} from '#/features/clients/service';
import {
  useClientSessionsTab,
  useSessionsReadable,
  type ClientSessions,
} from '#/features/clients/usecase/useClientSessionsTab.ts';
import { Button } from '#/shared/view/Button';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { Count } from '#/shared/view/Count';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { EmptyState } from '#/shared/view/EmptyState';
import { Pager } from '#/shared/view/Pager';
import { TableSkeleton } from '#/shared/view/Skeleton';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

const COLUMNS: readonly Column<TenantSession>[] = [
  {
    id: 'subject',
    header: 'Subject',
    isRowHeader: true,
    cell: (session) => <code>{session.username ?? session.subject_id}</code>,
  },
  {
    id: 'created_at',
    header: 'Signed in',
    cell: (session) => <Timestamp value={session.created_at} />,
  },
  {
    id: 'last_active_at',
    header: 'Last active',
    secondary: true,
    cell: (session) => <Timestamp value={session.last_active_at} />,
  },
  {
    id: 'remembered',
    header: 'Remembered',
    secondary: true,
    cell: (session) => (session.remembered ? <StatusTag tone="active">remembered</StatusTag> : '—'),
  },
];

function List({ client, page }: { client: Client; page: ClientSessions }) {
  const { list } = page;
  let body;
  switch (list.status) {
    case 'loading':
      body = <TableSkeleton label="Loading sessions" columns={COLUMNS} rows={2} />;
      break;
    case 'refused':
      body = <CapabilityNote capability={SESSIONS_CAPABILITY}>Sessions</CapabilityNote>;
      break;
    case 'failed':
      body = (
        <EmptyState
          variant="failed"
          title="The sessions could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
      break;
    case 'ready':
      body =
        list.rows.length === 0 ? (
          <p className={styles.rule}>{NO_SESSIONS}</p>
        ) : (
          <>
            <DataTable
              label={`Sessions through ${client.name}`}
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(session) => session.id}
              onRowAction={(id) => {
                const session = list.rows.find((each) => each.id === id);
                if (session !== undefined) page.open(session.subject_id);
              }}
            />
            <Pager
              label="Sessions"
              trail={list.trail}
              next={list.next}
              onTrailChange={list.setTrail}
              onLoadMore={list.loadMore}
              loadingMore={list.loadingMore}
            />
          </>
        );
  }
  return (
    <>
      {list.count === null ? null : (
        <div className={styles.actions}>
          <Count count={list.count.count} capped={list.count.capped} noun={SESSIONS_NOUN} />
        </div>
      )}
      {body}
    </>
  );
}

function Revoke({ client, page }: { client: Client; page: ClientSessions }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {REVOKE_HEADING}
      </h2>
      <p className={styles.rule}>{REVOKE_RULE}</p>
      {page.result === null ? null : (
        <p role="status" className={styles.text}>
          {page.result}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="danger" isDisabled={page.busy} onPress={page.ask}>
          {`Revoke every token of ${client.name}`}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={page.confirming}
        title={`Revoke every token of ${client.name}?`}
        consequence={page.consequence}
        confirmLabel="Revoke every token"
        tone="danger"
        typed={client.client_id}
        busy={page.busy}
        problem={page.problem}
        onConfirm={page.confirm}
        onCancel={page.cancel}
      />
    </section>
  );
}

function Sessions({ tenant, client, reach }: { tenant: string; client: Client; reach: Reach }) {
  const page = useClientSessionsTab(tenant, client, reach);
  return (
    <>
      <p className={styles.rule}>{SESSIONS_RULE}</p>
      <List client={client} page={page} />
      {page.offered ? <Revoke client={client} page={page} /> : null}
    </>
  );
}

export function SessionsTab({
  tenant,
  client,
  reach,
}: {
  tenant: string;
  client: Client;
  reach: Reach;
}) {
  const readable = useSessionsReadable(tenant);
  return (
    <div className={styles.tab}>
      {readable ? (
        <Sessions tenant={tenant} client={client} reach={reach} />
      ) : (
        <CapabilityNote capability={SESSIONS_CAPABILITY}>Sessions</CapabilityNote>
      )}
    </div>
  );
}
