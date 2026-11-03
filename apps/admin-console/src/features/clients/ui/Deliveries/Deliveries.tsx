import type { Client } from '#/entities/client';
import type { LogoutDelivery } from '#/features/clients/types/logoutDelivery';
import {
  DELIVERIES_HEADING,
  DELIVERIES_RULE,
  deliveryTone,
  NO_DELIVERIES,
  STATUS_OPTIONS,
} from '#/features/clients/services/deliveries';
import {
  useClientDeliveries,
  type ClientDeliveries,
} from '#/features/clients/use-cases/useClientDeliveries';
import { attemptsText } from '#/shared/services/format';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore } from '#/shared/ui/LoadMore';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

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
  return (
    <ListGate
      list={list}
      loading={<TableSkeleton label="Loading deliveries" columns={COLUMNS} rows={2} />}
      failed="The deliveries could not be loaded"
    >
      {() =>
        list.rows.length === 0 ? (
          <p className={recordTab.rule}>{NO_DELIVERIES}</p>
        ) : (
          <>
            <DataTable
              label={`Logout deliveries of ${client.name}`}
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(delivery) => delivery.id}
            />
            {list.more ? (
              <div className={recordTab.actions}>
                <LoadMore
                  noun="deliveries"
                  loading={list.loadingMore}
                  limited={list.loadLimited}
                  onPress={list.loadMore}
                />
              </div>
            ) : null}
          </>
        )
      }
    </ListGate>
  );
}

export function Deliveries({ tenant, client }: { tenant: string; client: Client }) {
  const page = useClientDeliveries(tenant, client);
  return (
    <Panel title={DELIVERIES_HEADING}>
      <p className={recordTab.rule}>{DELIVERIES_RULE}</p>
      <SelectField
        label="Show"
        options={STATUS_OPTIONS}
        value={page.status}
        onChange={page.setStatus}
      />
      <Rows client={client} page={page} />
    </Panel>
  );
}
