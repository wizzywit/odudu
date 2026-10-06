import type { Client, Role } from '@odudu/contracts/admin';
import { useId, type SubmitEvent } from 'react';
import {
  CLIENT_ROLES_RULE,
  NEW_ROLE_HEADING,
  NEW_ROLE_NAME_LABEL,
  NEW_ROLE_RULE,
  NO_CLIENT_ROLES,
  ROLES_CAPABILITY,
  ROLES_OPEN_LABEL,
} from '#/features/clients/service';
import {
  useClientRolesTab,
  type ClientRoles,
} from '#/features/clients/usecase/useClientRolesTab.ts';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { Count } from '#/shared/view/Count';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { EmptyState } from '#/shared/view/EmptyState';
import { TextAreaField, TextField } from '#/shared/view/Field';
import { Pager } from '#/shared/view/Pager';
import { TableSkeleton } from '#/shared/view/Skeleton';
import { StatusTag } from '#/shared/view/StatusTag';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

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
  let body;
  switch (list.status) {
    case 'loading':
      body = <TableSkeleton label="Loading roles" columns={COLUMNS} rows={2} />;
      break;
    case 'refused':
      body = <CapabilityNote capability={ROLES_CAPABILITY}>Roles</CapabilityNote>;
      break;
    case 'failed':
      body = (
        <EmptyState
          variant="failed"
          title="The roles could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
      break;
    case 'ready':
      body =
        list.rows.length === 0 ? (
          <p className={styles.rule}>{NO_CLIENT_ROLES}</p>
        ) : (
          <>
            <DataTable
              label={`Roles of ${client.name}`}
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(role) => role.id}
              onRowAction={page.open}
            />
            <Pager
              label="Roles"
              trail={list.trail}
              next={list.next}
              onTrailChange={list.setTrail}
              onLoadMore={list.loadMore}
              loadingMore={list.loadingMore}
            />
          </>
        );
  }
  return (
    <>
      {list.status === 'refused' ? null : (
        <div className={styles.actions}>
          {list.count === null ? null : (
            <Count count={list.count.count} capped={list.count.capped} noun={NOUN} />
          )}
          <ButtonLink href={page.listHref} size="small" variant="quiet">
            {ROLES_OPEN_LABEL}
          </ButtonLink>
        </div>
      )}
      {body}
    </>
  );
}

function NewRole({ page }: { page: ClientRoles }) {
  const heading = useId();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {NEW_ROLE_HEADING}
      </h2>
      <p className={styles.rule}>{NEW_ROLE_RULE}</p>
      <form noValidate onSubmit={submit} className={styles.form}>
        <TextField
          label={NEW_ROLE_NAME_LABEL}
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
        {page.message === null ? null : (
          <p role="alert" className={styles.message}>
            {page.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" isDisabled={page.busy}>
            {page.busy ? 'Creating…' : 'Create role'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function RolesTab({ tenant, client }: { tenant: string; client: Client }) {
  const page = useClientRolesTab(tenant, client);
  if (!page.readable) {
    return (
      <div className={styles.tab}>
        <CapabilityNote capability={ROLES_CAPABILITY}>Roles</CapabilityNote>
      </div>
    );
  }
  return (
    <div className={styles.tab}>
      <p className={styles.rule}>{CLIENT_ROLES_RULE}</p>
      <List client={client} page={page} />
      {page.needs.length === 0 ? (
        <NewRole page={page} />
      ) : (
        <ViewOnlyNote noun={`${client.name}'s roles`} change="make roles" needs={page.needs} />
      )}
    </div>
  );
}
