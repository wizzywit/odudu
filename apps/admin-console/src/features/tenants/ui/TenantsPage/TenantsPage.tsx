import type { Tenant } from '#/features/tenants/types/tenant';
import { Link } from 'react-aria-components';
import { areaAt } from '#/entities/area';
import { IMPORT_TENANT_HREF, NEW_TENANT_HREF } from '#/features/tenants/services/systemAddress';
import { useTenantsList } from '#/features/tenants/use-cases/useTenantsList';
import { SystemGate } from '#/widgets/shell';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import styles from '#/features/tenants/ui/TenantsPage/TenantsPage.module.css';
import { STATUS_FILTER } from '#/shared/services/filters';
import { tenantPage } from '#/shared/services/address';

const COLUMNS: readonly Column<Tenant>[] = [
  {
    id: 'name',
    header: 'Name',
    isRowHeader: true,
    cell: (tenant) => <code className={styles.name}>{tenant.name}</code>,
  },
  { id: 'display_name', header: 'Display name', cell: (tenant) => tenant.displayName ?? '—' },
  {
    id: 'enabled',
    header: 'Status',
    cell: (tenant) => <EnabledTag enabled={tenant.enabled} />,
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (tenant) => <Timestamp value={tenant.createdAt} />,
  },
  {
    id: 'enter',
    header: 'Console',
    cell: (tenant) => (
      <Link href={tenantPage(tenant.name)} className={styles.enter ?? ''}>
        {`Enter ${tenant.name}`}
      </Link>
    ),
  },
];

const SEARCH = [
  { id: 'name', label: 'Name' },
  { id: 'display_name', label: 'Display name' },
];

const TITLE = areaAt('tenants').label;

function List() {
  const { list, open, recordNeeds } = useTenantsList();
  return (
    <ResourceListPage
      list={list}
      kicker="System"
      title={TITLE}
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
          options={STATUS_FILTER}
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
    <SystemGate tenant={tenant} title={TITLE}>
      <List />
    </SystemGate>
  );
}
