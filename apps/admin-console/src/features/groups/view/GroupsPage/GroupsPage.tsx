import type { Group } from '@odudu/contracts/admin';
import { AreaGate, areaAt } from '#/features/shell';
import { useGroupsList } from '#/features/groups/usecase/useGroupsList.ts';
import { GroupTree } from '#/features/groups/view/GroupsPage/GroupTree.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink';
import type { Column } from '#/shared/view/DataTable';
import { ResourceListPage } from '#/shared/view/ResourceListPage';
import { StatusTag } from '#/shared/view/StatusTag';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/groups/view/GroupsPage/GroupTree.module.css';

const COLUMNS: readonly Column<Group>[] = [
  {
    id: 'path',
    header: 'Group',
    isRowHeader: true,
    cell: (group) => <span className={styles.name}>{group.path}</span>,
  },
  { id: 'description', header: 'Description', cell: (group) => group.description ?? '—' },
  {
    id: 'default',
    header: 'New subjects',
    cell: (group) =>
      group.default_for_new_subjects ? <StatusTag tone="active">join it</StatusTag> : '—',
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (group) => <Timestamp value={group.created_at} />,
  },
];

const SEARCH = [{ id: 'name', label: 'Name' }];

function List({ tenant }: { tenant: string }) {
  const page = useGroupsList(tenant);
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title="Groups"
      description="Groups gather subjects, and every role a group carries is held by its members and by the members of every group beneath it. A search matches the start of a group's own name, at any level."
      actions={
        <ButtonLink href={page.createHref} variant="primary">
          Create a group
        </ButtonLink>
      }
      noun={
        page.searching || page.list.rows.length === 0
          ? { one: 'group', other: 'groups' }
          : { one: 'top-level group', other: 'top-level groups' }
      }
      searchFields={SEARCH}
      columns={COLUMNS}
      rowKey={(group) => group.id}
      onRowAction={(id) => {
        page.open(id);
      }}
      capability="manage-tenant"
      nothingYet="A group gathers subjects, so that the roles it carries reach all of them at once."
      {...(page.searching
        ? {}
        : { renderRows: (rows: readonly Group[]) => <GroupTree tenant={tenant} roots={rows} /> })}
    />
  );
}

export function GroupsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('groups')} title="Groups">
      <List tenant={tenant} />
    </AreaGate>
  );
}
