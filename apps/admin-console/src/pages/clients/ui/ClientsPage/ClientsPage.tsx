import type { Client } from '#/entities/client';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useClientsList } from '#/pages/clients/use-cases/useClientsList';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/clients/ui/ClientsPage/ClientsPage.module.css';

const AREA = areaAt('clients');

function columnsOf(typeText: Readonly<Record<string, string>>): readonly Column<Client>[] {
  return [
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
    { id: 'type', header: 'Type', cell: (client) => typeText[client.type] ?? client.type },
    {
      id: 'enabled',
      header: 'Status',
      cell: (client) => <EnabledTag enabled={client.enabled} />,
    },
    {
      id: 'created_at',
      header: 'Created',
      secondary: true,
      cell: (client) => <Timestamp value={client.created_at} />,
    },
  ];
}

const SEARCH = [
  { id: 'name', label: 'Name' },
  { id: 'client_id', label: 'Client ID' },
];

const TYPES = [
  { id: 'any', label: 'Any type' },
  { id: 'confidential', label: 'Confidential' },
  { id: 'public', label: 'Public' },
];

function List({ tenant }: { tenant: string }) {
  const page = useClientsList(tenant);
  const { list } = page;
  return (
    <ResourceListPage
      list={list}
      kicker={tenant}
      title={AREA.label}
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
            options={page.statusFilter}
            value={list.filters.enabled ?? 'any'}
            onChange={(value) => {
              list.setFilter('enabled', value === 'any' ? null : value);
            }}
          />
        </>
      }
      columns={columnsOf(page.typeText)}
      rowKey={(client) => client.id}
      onRowAction={page.open}
      capability="manage-clients"
      nothingYet="A client is an application that signs people in through this tenant: a web application, a single-page app, or a service that calls another."
    />
  );
}

export function ClientsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
