import type { Subject } from '@odudu/contracts/admin';
import { subjectName } from '#/features/subjects/services/address';
import { useMembers, useMembersReadable } from '#/features/subjects/use-cases/useMembers';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { Count } from '#/shared/ui/Count';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ListGate } from '#/shared/ui/ListGate';
import { Pager } from '#/shared/ui/Pager';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { recordTab } from '#/shared/ui/RecordTab';

const COLUMNS: readonly Column<Subject>[] = [
  {
    id: 'username',
    header: 'Username',
    isRowHeader: true,
    cell: (subject) => <code>{subjectName(subject)}</code>,
  },
  { id: 'email', header: 'Email', cell: (subject) => subject.email ?? '—' },
  {
    id: 'enabled',
    header: 'Status',
    cell: (subject) => <EnabledTag enabled={subject.enabled} />,
  },
];

const NOUN = { one: 'member', other: 'members' };

const SCOPE = {
  group: (name: string) =>
    `Subjects who belong to ${name} itself; members of the groups beneath it are not listed, though they receive its roles too.`,
  role: (name: string) =>
    `Subjects ${name} is assigned to directly; those who hold it through a group or nested in another role are not listed.`,
};

const NOBODY = {
  group: (name: string) => `Nobody belongs to ${name} directly yet.`,
  role: (name: string) => `Nobody is assigned ${name} directly yet.`,
};

function List({
  tenant,
  by,
  id,
  name,
}: {
  tenant: string;
  by: 'group' | 'role';
  id: string;
  // How the record is known in running text: a group's path, a role's name.
  name: string;
}) {
  const { list, listHref, open } = useMembers(tenant, by, id);
  const label = by === 'group' ? `Members of ${name}` : `Holders of ${name}`;
  return (
    <>
      {list.status === 'refused' ? null : (
        <div className={recordTab.actions}>
          {list.count === null ? null : (
            <Count count={list.count.count} capped={list.count.capped} noun={NOUN} />
          )}
          <ButtonLink href={listHref} size="small" variant="quiet">
            Open them in Subjects
          </ButtonLink>
        </div>
      )}
      <ListGate
        list={list}
        loading={<TableSkeleton label="Loading members" columns={COLUMNS} rows={2} />}
        refused={{ capability: 'view-users', noun: 'Members' }}
        failed="The members could not be loaded"
      >
        {() =>
          list.rows.length === 0 ? (
            <p className={recordTab.rule}>{NOBODY[by](name)}</p>
          ) : (
            <>
              <DataTable
                label={label}
                columns={COLUMNS}
                rows={list.rows}
                rowKey={(subject) => subject.id}
                onRowAction={open}
              />
              <Pager label="Members" list={list} />
            </>
          )
        }
      </ListGate>
    </>
  );
}

// A group's or a role's Members tab: the subjects list narrowed to it.
export function SubjectMembers({
  tenant,
  by,
  id,
  name,
}: {
  tenant: string;
  by: 'group' | 'role';
  id: string;
  // How the record is known in running text: a group's path, a role's name.
  name: string;
}) {
  const readable = useMembersReadable(tenant);
  return (
    <div className={recordTab.tab}>
      <p className={recordTab.rule}>{SCOPE[by](name)}</p>
      {readable ? (
        <List tenant={tenant} by={by} id={id} name={name} />
      ) : (
        <CapabilityNote capability="view-users">Members</CapabilityNote>
      )}
    </div>
  );
}
