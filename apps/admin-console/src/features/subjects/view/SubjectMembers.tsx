import type { Subject } from '@odudu/contracts/admin';
import { subjectName } from '#/features/subjects/service.ts';
import { useMembers, useMembersReadable } from '#/features/subjects/usecase/useMembers.ts';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { Count } from '#/shared/view/Count.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { TableSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

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
    cell: (subject) =>
      subject.enabled ? (
        <StatusTag tone="active">enabled</StatusTag>
      ) : (
        <StatusTag tone="danger">disabled</StatusTag>
      ),
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
  let body;
  switch (list.status) {
    case 'loading':
      body = <TableSkeleton label="Loading members" columns={COLUMNS} rows={2} />;
      break;
    case 'refused':
      body = <CapabilityNote capability="view-users">Members</CapabilityNote>;
      break;
    case 'failed':
      body = (
        <EmptyState
          variant="failed"
          title="The members could not be loaded"
          action={<Button onPress={list.retry}>Try again</Button>}
        >
          The gateway did not answer, or answered with an error.
        </EmptyState>
      );
      break;
    case 'ready':
      body =
        list.rows.length === 0 ? (
          <p className={styles.rule}>{NOBODY[by](name)}</p>
        ) : (
          <>
            <DataTable
              label={label}
              columns={COLUMNS}
              rows={list.rows}
              rowKey={(subject) => subject.id}
              onRowAction={open}
            />
            <Pager
              label="Members"
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
          <ButtonLink href={listHref} size="small" variant="quiet">
            Open them in Subjects
          </ButtonLink>
        </div>
      )}
      {body}
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
    <div className={styles.tab}>
      <p className={styles.rule}>{SCOPE[by](name)}</p>
      {readable ? (
        <List tenant={tenant} by={by} id={id} name={name} />
      ) : (
        <CapabilityNote capability="view-users">Members</CapabilityNote>
      )}
    </div>
  );
}
