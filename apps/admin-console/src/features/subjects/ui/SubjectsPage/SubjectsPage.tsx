import { SUBJECT_CAPABILITY_FILTER, type Subject } from '@odudu/contracts/admin';
import { useSubjectsList } from '#/features/subjects/use-cases/useSubjectsList';
import { SubjectsGate } from '#/features/subjects/ui/SubjectsGate';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import type { Column } from '#/shared/ui/DataTable';
import { SelectField } from '#/shared/ui/Field';
import { NarrowedNote } from '#/shared/ui/NarrowedNote';
import { ResourceListPage } from '#/shared/ui/ResourceListPage';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import styles from '#/features/subjects/ui/SubjectsPage/SubjectsPage.module.css';
import { STATUS_FILTER } from '#/shared/services/filters';
import { subjectName } from '#/features/subjects/services/subjectName';

const COLUMNS: readonly Column<Subject>[] = [
  {
    id: 'username',
    header: 'Username',
    isRowHeader: true,
    cell: (subject) => <span className={styles.name}>{subjectName(subject)}</span>,
  },
  { id: 'email', header: 'Email', cell: (subject) => subject.email ?? '—' },
  {
    id: 'enabled',
    header: 'Status',
    cell: (subject) => <EnabledTag enabled={subject.enabled} />,
  },
  {
    id: 'created_at',
    header: 'Created',
    secondary: true,
    cell: (subject) => <Timestamp value={subject.created_at} />,
  },
];

const SEARCH = [
  { id: 'username', label: 'Username' },
  { id: 'email', label: 'Email' },
];

// `any` is the server's own value, the holders of at least one capability.
const CAPABILITY = [
  { id: 'all', label: 'Holding anything or nothing' },
  ...SUBJECT_CAPABILITY_FILTER.map((capability) => ({
    id: capability,
    label: capability === 'any' ? 'Any capability' : capability,
  })),
];

// Set from a role's or a group's own page; the id is all the list knows.
const NARROWING = [
  { filter: 'role', phrase: 'Only subjects holding the role', all: 'Show every role' },
  { filter: 'group', phrase: 'Only members of the group', all: 'Show every group' },
] as const;

function List({ tenant }: { tenant: string }) {
  const { list, createHref, changeNeeds, open } = useSubjectsList(tenant);
  return (
    <ResourceListPage
      list={list}
      kicker={tenant}
      title="Subjects"
      description="The people and services that sign in to this tenant. Open one to change its profile or its credentials."
      {...(createHref === null
        ? {}
        : {
            actions: (
              <ButtonLink href={createHref} variant="primary">
                Create a subject
              </ButtonLink>
            ),
          })}
      noun={{ one: 'subject', other: 'subjects' }}
      {...(changeNeeds.length === 0
        ? {}
        : { viewOnly: <ViewOnlyNote noun="subjects" needs={changeNeeds} /> })}
      searchFields={SEARCH}
      filters={
        <>
          <SelectField
            label="Status"
            options={STATUS_FILTER}
            value={list.filters.enabled ?? 'any'}
            onChange={(value) => {
              list.setFilter('enabled', value === 'any' ? null : value);
            }}
          />
          <SelectField
            label="Capability"
            description="Held directly, through a group or nested in another role."
            options={CAPABILITY}
            value={list.filters.capability ?? 'all'}
            onChange={(value) => {
              list.setFilter('capability', value === 'all' ? null : value);
            }}
          />
          {NARROWING.map(({ filter, phrase, all }) => {
            const id = list.filters[filter];
            return id === undefined ? null : (
              <NarrowedNote
                key={filter}
                all={all}
                onClear={() => {
                  list.setFilter(filter, null);
                }}
              >
                {`${phrase} `}
                <code>{id}</code>
                {' directly.'}
              </NarrowedNote>
            );
          })}
        </>
      }
      columns={COLUMNS}
      rowKey={(subject) => subject.id}
      onRowAction={open}
      capability="view-users"
      nothingYet="Nobody signs in to this tenant yet."
    />
  );
}

export function SubjectsPage({ tenant }: { tenant: string }) {
  return (
    <SubjectsGate tenant={tenant} title="Subjects">
      <List tenant={tenant} />
    </SubjectsGate>
  );
}
