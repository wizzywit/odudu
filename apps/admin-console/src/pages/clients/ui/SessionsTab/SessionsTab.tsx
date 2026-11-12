import type { Client } from '#/entities/client';
import type { ClientSession } from '#/pages/clients/types/clientSession';
import { type ServiceAccountReach } from '#/pages/clients/services/ceiling';
import {
  useClientSessionsTab,
  useSessionsPanel,
  type ClientSessions,
} from '#/pages/clients/use-cases/useClientSessionsTab';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { Count } from '#/shared/ui/Count';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { DeviceCell } from '#/shared/ui/DeviceCell';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ListGate } from '#/shared/ui/ListGate';
import { Pager } from '#/shared/ui/Pager';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

function columnsOf(
  subjectLabel: (session: ClientSession) => string,
  deviceCaption: (device: string | null) => string | null,
): readonly Column<ClientSession>[] {
  return [
    {
      id: 'subject',
      header: 'Subject',
      isRowHeader: true,
      cell: (session) => <code>{subjectLabel(session)}</code>,
    },
    {
      id: 'device',
      header: 'Device',
      secondary: true,
      cell: (session) => (
        <DeviceCell device={session.device} caption={deviceCaption(session.device)} />
      ),
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
      cell: (session) =>
        session.remembered ? <StatusTag tone="active">remembered</StatusTag> : '—',
    },
  ];
}

function List({ client, page }: { client: Client; page: ClientSessions }) {
  const { list } = page;
  const columns = columnsOf(page.subjectLabel, page.deviceCaption);
  return (
    <>
      {list.count === null ? null : (
        <div className={recordTab.actions}>
          <Count count={list.count.count} capped={list.count.capped} noun={page.noun} />
        </div>
      )}
      <ListGate
        list={list}
        loading={<TableSkeleton label="Loading sessions" columns={columns} rows={2} />}
        refused={{ capability: page.capability, noun: 'Sessions' }}
        failed="The sessions could not be loaded"
      >
        {() =>
          list.rows.length === 0 ? (
            <p className={recordTab.rule}>{page.empty}</p>
          ) : (
            <>
              <DataTable
                label={`Sessions through ${client.name}`}
                columns={columns}
                rows={list.rows}
                rowKey={(session) => session.id}
                onRowAction={(id) => {
                  const session = list.rows.find((each) => each.id === id);
                  if (session !== undefined) page.open(session.subject_id);
                }}
              />
              <Pager label="Sessions" list={list} />
            </>
          )
        }
      </ListGate>
    </>
  );
}

function Revoke({ client, page }: { client: Client; page: ClientSessions }) {
  return (
    <Panel title={page.revokeHeading}>
      <p className={recordTab.rule}>{page.revokeRule}</p>
      {page.result === null ? null : (
        <p role="status" className={recordTab.text}>
          {page.result}
        </p>
      )}
      <div className={recordTab.actions}>
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
    </Panel>
  );
}

function Sessions({
  tenant,
  client,
  reach,
}: {
  tenant: string;
  client: Client;
  reach: ServiceAccountReach;
}) {
  const page = useClientSessionsTab(tenant, client, reach);
  return (
    <>
      <p className={recordTab.rule}>{page.rule}</p>
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
  reach: ServiceAccountReach;
}) {
  const panel = useSessionsPanel(tenant);
  return (
    <div className={recordTab.tab}>
      {panel.readable ? (
        <Sessions tenant={tenant} client={client} reach={reach} />
      ) : (
        <CapabilityNote capability={panel.capability}>Sessions</CapabilityNote>
      )}
    </div>
  );
}
