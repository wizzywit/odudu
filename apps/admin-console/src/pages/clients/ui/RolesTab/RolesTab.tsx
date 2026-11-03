import type { Role } from '@odudu/contracts/admin';
import type { Client } from '#/entities/client';
import { type SubmitEvent } from 'react';
import {
  useClientRolesTab,
  useRolesPanel,
  type ClientRoles,
} from '#/pages/clients/use-cases/useClientRolesTab';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { Count } from '#/shared/ui/Count';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { TextAreaField, TextField } from '#/shared/ui/Field';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ListGate } from '#/shared/ui/ListGate';
import { Pager } from '#/shared/ui/Pager';
import { Problem } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import { recordTab } from '#/shared/ui/RecordTab';

const COLUMNS: readonly Column<Role>[] = [
  { id: 'name', header: 'Role', isRowHeader: true, cell: (role) => <code>{role.name}</code> },
  { id: 'description', header: 'Description', cell: (role) => role.description ?? '—' },
  {
    id: 'default',
    header: 'New subjects',
    cell: (role) =>
      role.default_for_new_subjects ? <StatusTag tone="active">get it</StatusTag> : '—',
  },
];

const NOUN = { one: 'role', other: 'roles' };

function List({ client, page }: { client: Client; page: ClientRoles }) {
  const { list } = page;
  return (
    <>
      {list.status === 'refused' ? null : (
        <div className={recordTab.actions}>
          {list.count === null ? null : (
            <Count count={list.count.count} capped={list.count.capped} noun={NOUN} />
          )}
          <ButtonLink href={page.listHref} size="small" variant="quiet">
            {page.openLabel}
          </ButtonLink>
        </div>
      )}
      <ListGate
        list={list}
        loading={<TableSkeleton label="Loading roles" columns={COLUMNS} rows={2} />}
        refused={{ capability: page.capability, noun: 'Roles' }}
        failed="The roles could not be loaded"
      >
        {() =>
          list.rows.length === 0 ? (
            <p className={recordTab.rule}>{page.empty}</p>
          ) : (
            <>
              <DataTable
                label={`Roles of ${client.name}`}
                columns={COLUMNS}
                rows={list.rows}
                rowKey={(role) => role.id}
                onRowAction={page.open}
              />
              <Pager label="Roles" list={list} />
            </>
          )
        }
      </ListGate>
    </>
  );
}

function NewRole({ page }: { page: ClientRoles }) {
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  return (
    <Panel title={page.newRoleHeading}>
      <p className={recordTab.rule}>{page.newRoleRule}</p>
      <form noValidate onSubmit={submit} className={recordTab.form}>
        <TextField
          label={page.newRoleNameLabel}
          mono
          value={page.name}
          error={page.errors.name}
          onChange={page.editName}
        />
        <TextAreaField
          label="Description"
          description={page.descriptionRule}
          limit={page.descriptionLimit}
          value={page.description}
          error={page.errors.description}
          onChange={page.editDescription}
        />
        <Problem>{page.message}</Problem>
        <div className={recordTab.actions}>
          <Button type="submit" variant="primary" isDisabled={page.busy}>
            {page.busy ? 'Creating…' : 'Create role'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Roles({ tenant, client }: { tenant: string; client: Client }) {
  const page = useClientRolesTab(tenant, client);
  return (
    <>
      <p className={recordTab.rule}>{page.rule}</p>
      <List client={client} page={page} />
      {page.needs.length === 0 ? (
        <NewRole page={page} />
      ) : (
        <ViewOnlyNote noun={`${client.name}'s roles`} change="make roles" needs={page.needs} />
      )}
    </>
  );
}

export function RolesTab({ tenant, client }: { tenant: string; client: Client }) {
  const panel = useRolesPanel(tenant);
  return (
    <div className={recordTab.tab}>
      {panel.readable ? (
        <Roles tenant={tenant} client={client} />
      ) : (
        <CapabilityNote capability={panel.capability}>Roles</CapabilityNote>
      )}
    </div>
  );
}
