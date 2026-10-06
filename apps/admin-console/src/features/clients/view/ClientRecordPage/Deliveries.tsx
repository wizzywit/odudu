import type { Client, LogoutDelivery } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  attemptsText,
  DELIVERIES_HEADING,
  DELIVERIES_RULE,
  deliveryTone,
  NO_DELIVERIES,
  STATUS_OPTIONS,
} from '#/features/clients/service';
import {
  useClientDeliveries,
  type ClientDeliveries,
} from '#/features/clients/usecase/useClientDeliveries.ts';
import { Button } from '#/shared/view/Button';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { EmptyState } from '#/shared/view/EmptyState';
import { SelectField } from '#/shared/view/Field';
import { TableSkeleton } from '#/shared/view/Skeleton';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

const COLUMNS: readonly Column<LogoutDelivery>[] = [
  {
    id: 'endpoint',
    header: 'Address',
    isRowHeader: true,
    cell: (delivery) => <code>{delivery.endpoint}</code>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (delivery) => (
      <StatusTag tone={deliveryTone(delivery.status)}>{delivery.status}</StatusTag>
    ),
  },
  { id: 'attempts', header: 'Attempts', cell: (delivery) => attemptsText(delivery.attempts) },
  {
    id: 'last_error',
    header: 'Last error',
    secondary: true,
    cell: (delivery) => delivery.last_error ?? '—',
  },
  {
    id: 'created_at',
    header: 'Queued',
    secondary: true,
    cell: (delivery) => <Timestamp value={delivery.created_at} />,
  },
];

function Rows({ client, page }: { client: Client; page: ClientDeliveries }) {
  const { list } = page;
  switch (list.status) {
    case 'loading':
      return <TableSkeleton label="Loading deliveries" columns={COLUMNS} rows={2} />;
    case 'refused':
    case 'failed':
      return (
        <EmptyState
          variant="failed"
          title="The deliveries could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
    case 'ready':
      break;
  }
  if (list.rows.length === 0) return <p className={styles.rule}>{NO_DELIVERIES}</p>;
  return (
    <>
      <DataTable
        label={`Logout deliveries of ${client.name}`}
        columns={COLUMNS}
        rows={list.rows}
        rowKey={(delivery) => delivery.id}
      />
      {list.more ? (
        <div className={styles.actions}>
          <Button isDisabled={list.loadingMore} onPress={list.loadMore}>
            {list.loadingMore ? 'Loading more deliveries…' : 'Load more deliveries'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function Deliveries({ tenant, client }: { tenant: string; client: Client }) {
  const heading = useId();
  const page = useClientDeliveries(tenant, client);
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {DELIVERIES_HEADING}
      </h2>
      <p className={styles.rule}>{DELIVERIES_RULE}</p>
      <SelectField
        label="Show"
        options={STATUS_OPTIONS}
        value={page.status}
        onChange={page.setStatus}
      />
      <Rows client={client} page={page} />
    </section>
  );
}
