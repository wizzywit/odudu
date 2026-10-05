import type { Tenant } from '@odudu/contracts/admin';
import { Link } from 'react-aria-components';
import { enterHref, IMPORT_TENANT_HREF, NEW_TENANT_HREF } from '#/features/tenants/service.ts';
import { useTenantsList } from '#/features/tenants/usecase/useTenantsList.ts';
import { SystemGate } from '#/features/tenants/view/SystemGate.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink';
import type { Column } from '#/shared/view/DataTable';
import { SelectField } from '#/shared/view/Field';
import { ResourceListPage } from '#/shared/view/ResourceListPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import styles from '#/features/tenants/view/TenantsPage.module.css';

const COLUMNS: readonly Column<Tenant>[] = [
  {
    id: 'name',
    header: 'Name',
    isRowHeader: true,
    cell: (tenant) => <code className={styles.name}>{tenant.name}</code>,
  },
  { id: 'display_name', header: 'Display name', cell: (tenant) => tenant.display_name ?? '—' },
  {
    id: 'enabled',
    header: 'Status',
    cell: (tenant) =>
      tenant.enabled ? (
        <StatusTag tone="active">enabled</StatusTag>
      ) : (
        <StatusTag tone="danger">disabled</StatusTag>
      ),
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (tenant) => <Timestamp value={tenant.created_at} />,
  },
  {
    id: 'enter',
    header: 'Console',
    cell: (tenant) => (
      <Link href={enterHref(tenant.name)} className={styles.enter ?? ''}>
        {`Enter ${tenant.name}`}
      </Link>
    ),
  },
];

const SEARCH = [
  { id: 'name', label: 'Name' },
  { id: 'display_name', label: 'Display name' },
];

const STATUS = [
  { id: 'any', label: 'Any status' },
  { id: 'true', label: 'Enabled' },
  { id: 'false', label: 'Disabled' },
];

function List() {
  const { list, open, recordNeeds } = useTenantsList();
  return (
    <ResourceListPage
      list={list}
      kicker="System"
      title="Tenants"
      description="Every tenant of this deployment. Open one to see its administrators, change it or export it."
      actions={
        <>
          <ButtonLink href={IMPORT_TENANT_HREF}>Import a tenant</ButtonLink>
          <ButtonLink href={NEW_TENANT_HREF} variant="primary">
            Create a tenant
          </ButtonLink>
        </>
      }
      noun={{ one: 'tenant', other: 'tenants' }}
      searchFields={SEARCH}
      filters={
        <SelectField
          label="Status"
          options={STATUS}
          value={list.filters.enabled ?? 'any'}
          onChange={(value) => {
            list.setFilter('enabled', value === 'any' ? null : value);
          }}
        />
      }
      columns={COLUMNS}
      rowKey={(tenant) => tenant.name}
      {...(open === null ? {} : { onRowAction: open })}
      {...(recordNeeds.length === 0
        ? {}
        : {
            viewOnly: (
              <ViewOnlyNote noun="tenants" change="open their records" needs={recordNeeds} />
            ),
          })}
      capability="manage-tenants"
      nothingYet="Only the system tenant exists until another is created or imported."
    />
  );
}

export function TenantsPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate tenant={tenant} title="Tenants">
      <List />
    </SystemGate>
  );
}
