import type { Client } from '@odudu/contracts/admin';
import { AreaGate, areaAt } from '#/features/shell';
import { TYPE_TEXT } from '#/features/clients/service';
import { useClientsList } from '#/features/clients/usecase/useClientsList.ts';
import { ButtonLink } from '#/shared/view/ButtonLink';
import type { Column } from '#/shared/view/DataTable';
import { SelectField } from '#/shared/view/Field';
import { ResourceListPage } from '#/shared/view/ResourceListPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/clients/view/ClientsPage/ClientsPage.module.css';

const COLUMNS: readonly Column<Client>[] = [
  {
    id: 'name',
    header: 'Client',
    isRowHeader: true,
    cell: (client) => (
      <span className={styles.name}>
        <span>{client.name}</span>
        <code className={styles.clientId}>{client.client_id}</code>
      </span>
    ),
  },
  { id: 'type', header: 'Type', cell: (client) => TYPE_TEXT[client.type] ?? client.type },
  {
    id: 'enabled',
    header: 'Status',
    cell: (client) =>
      client.enabled ? (
        <StatusTag tone="active">enabled</StatusTag>
      ) : (
        <StatusTag tone="danger">disabled</StatusTag>
      ),
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (client) => <Timestamp value={client.created_at} />,
  },
];

const SEARCH = [
  { id: 'name', label: 'Name' },
  { id: 'client_id', label: 'Client ID' },
];

const TYPES = [
  { id: 'any', label: 'Any type' },
  { id: 'confidential', label: 'Confidential' },
  { id: 'public', label: 'Public' },
];

const STATUS = [
  { id: 'any', label: 'Any status' },
  { id: 'true', label: 'Enabled' },
  { id: 'false', label: 'Disabled' },
];

function List({ tenant }: { tenant: string }) {
  const page = useClientsList(tenant);
  const { list } = page;
  return (
    <ResourceListPage
      list={list}
      kicker={tenant}
      title="Clients"
      description="A client is an application that signs people in through this tenant. A search matches the start of a client's name, or of its ID, and reaches every client, however many there are."
      actions={
        <ButtonLink href={page.createHref} variant="primary">
          Create a client
        </ButtonLink>
      }
      noun={{ one: 'client', other: 'clients' }}
      searchFields={SEARCH}
      filters={
        <>
          <SelectField
            label="Type"
            options={TYPES}
            value={list.filters.type ?? 'any'}
            onChange={(value) => {
              list.setFilter('type', value === 'any' ? null : value);
            }}
          />
          <SelectField
            label="Status"
            options={STATUS}
            value={list.filters.enabled ?? 'any'}
            onChange={(value) => {
              list.setFilter('enabled', value === 'any' ? null : value);
            }}
          />
        </>
      }
      columns={COLUMNS}
      rowKey={(client) => client.id}
      onRowAction={page.open}
      capability="manage-clients"
      nothingYet="A client is an application that signs people in through this tenant: a web application, a single-page app, or a service that calls another."
    />
  );
}

export function ClientsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('clients')} title="Clients">
      <List tenant={tenant} />
    </AreaGate>
  );
}
