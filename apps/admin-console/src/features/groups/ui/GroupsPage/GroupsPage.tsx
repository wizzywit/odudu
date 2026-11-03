import type { Group } from '#/entities/group';
import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useGroupsList } from '#/features/groups/use-cases/useGroupsList';
import { GroupTree } from '#/features/groups/ui/GroupsPage/GroupTree';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/features/groups/ui/GroupsPage/GroupTree.module.css';
import { NAME_SEARCH } from '#/shared/services/filters';

const AREA = areaAt('groups');

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

function List({ tenant }: { tenant: string }) {
  const page = useGroupsList(tenant);
  return (
    <ResourceListPage
      list={page.list}
      kicker={tenant}
      title={AREA.label}
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
      searchFields={NAME_SEARCH}
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
    <AreaGate tenant={tenant} area={AREA} title={AREA.label}>
      <List tenant={tenant} />
    </AreaGate>
  );
}
