import type { Client } from '#/entities/client';
import type { DeliveryRow } from '#/pages/clients/services/deliveries';
import {
  useClientDeliveries,
  type ClientDeliveries,
} from '#/pages/clients/use-cases/useClientDeliveries';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore } from '#/shared/ui/LoadMore';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

const COLUMNS: readonly Column<DeliveryRow>[] = [
  {
    id: 'endpoint',
    header: 'Address',
    isRowHeader: true,
    cell: (delivery) => <code>{delivery.endpoint}</code>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (delivery) => <StatusTag tone={delivery.tone}>{delivery.status}</StatusTag>,
  },
  { id: 'attempts', header: 'Attempts', cell: (delivery) => delivery.attempts },
  {
    id: 'last_error',
    header: 'Last error',
    secondary: true,
    cell: (delivery) => delivery.lastError ?? '—',
  },
  {
    id: 'created_at',
    header: 'Queued',
    secondary: true,
    cell: (delivery) => <Timestamp value={delivery.createdAt} />,
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
          <p className={recordTab.rule}>{page.empty}</p>
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
    <Panel title={page.heading}>
      <p className={recordTab.rule}>{page.rule}</p>
      <SelectField
        label="Show"
        options={page.statusOptions}
        value={page.status}
        onChange={page.setStatus}
      />
      <Rows client={client} page={page} />
    </Panel>
  );
}
