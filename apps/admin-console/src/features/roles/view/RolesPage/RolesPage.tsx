import type { Role } from '@odudu/contracts/admin';
import { AreaGate, areaAt } from '#/features/shell';
import { useRolesList } from '#/features/roles/usecase/useRolesList.ts';
import { RoleOwner } from '#/shared/view/RoleOwner';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import type { Column } from '#/shared/view/DataTable';
import { SelectField } from '#/shared/view/Field';
import { ResourceListPage } from '#/shared/view/ResourceListPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/roles/view/RolesPage/RolesPage.module.css';

const COLUMNS: readonly Column<Role>[] = [
  {
    id: 'name',
    header: 'Role',
    isRowHeader: true,
    cell: (role) => <code className={styles.name}>{role.name}</code>,
  },
  { id: 'owner', header: 'Belongs to', cell: (role) => <RoleOwner role={role} /> },
  { id: 'description', header: 'Description', cell: (role) => role.description ?? '—' },
  {
    id: 'default',
    header: 'New subjects',
    cell: (role) =>
      role.default_for_new_subjects ? <StatusTag tone="active">get it</StatusTag> : '—',
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (role) => <Timestamp value={role.created_at} />,
  },
];

const SEARCH = [{ id: 'name', label: 'Name' }];

// `tenant` is the server's own value; a client's id narrows to its roles,
// set from that client's page.
const OWNERS = [
  { id: 'any', label: 'Tenant or client' },
  { id: 'tenant', label: 'Tenant roles' },
];

function List({ tenant }: { tenant: string }) {
  const page = useRolesList(tenant);
  const client = page.list.filters.client;
  const one = client !== undefined && client !== 'tenant';
  // Its own rows name the client, by the name a person knows it by.
  const key = one
    ? page.list.rows.find((role) => role.client_id === client)?.client_key
    : undefined;
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title="Roles"
      description="A tenant role is carried in tokens by its name; a client's role by its client's name and its own. The admin capabilities are the built-in admin client's roles."
      actions={
        <ButtonLink href={page.createHref} variant="primary">
          Create a role
        </ButtonLink>
      }
      noun={{ one: 'role', other: 'roles' }}
      searchFields={SEARCH}
      filters={
        one ? (
          <p className={styles.narrowed}>
            <span>
              {'Only the roles of client '}
              <code title={client}>{key ?? client}</code>.
            </span>
            <Button
              size="small"
              variant="quiet"
              onPress={() => {
                page.list.setFilter('client', null);
              }}
            >
              Show every role
            </Button>
          </p>
        ) : (
          <SelectField
            label="Belongs to"
            options={OWNERS}
            value={client ?? 'any'}
            onChange={(value) => {
              page.list.setFilter('client', value === 'any' ? null : value);
            }}
          />
        )
      }
      columns={COLUMNS}
      rowKey={(role) => role.id}
      onRowAction={page.open}
      capability="manage-tenant"
      nothingYet="A role is a name a token carries, and what an application grants by."
    />
  );
}

export function RolesPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('roles')} title="Roles">
      <List tenant={tenant} />
    </AreaGate>
  );
}
