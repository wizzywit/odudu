import type { Subject } from '@odudu/contracts/admin';
import { useId } from 'react';
import { Link } from 'react-aria-components';
import {
  useSystemAdministratorsPage,
  type RevokeProblem,
  type SystemAdministrators,
} from '#/features/system-admins/usecase/useSystemAdministratorsPage.ts';
import { CapabilityHolders } from '#/features/subjects/index.ts';
import { SystemGate } from '#/features/tenants/index.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { Button } from '#/shared/view/Button.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import type { Column } from '#/shared/view/DataTable.tsx';
import { SelectField } from '#/shared/view/Field.tsx';
import { Picker } from '#/shared/view/Picker.tsx';
import { ResourceListPage } from '#/shared/view/ResourceListPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote.tsx';
import styles from '#/features/system-admins/view/SystemAdministratorsPage.module.css';

const TITLE = 'System administrators';
const NOUN = { one: 'system administrator', other: 'system administrators' };
const SEARCH = [{ id: 'username', label: 'Username' }];
const STATUS = [
  { id: 'any', label: 'Any status' },
  { id: 'true', label: 'Enabled' },
  { id: 'false', label: 'Disabled' },
];

function nameOf(subject: Subject): string {
  return subject.username ?? subject.id;
}

function columns(page: SystemAdministrators, reasonId: string): readonly Column<Subject>[] {
  const shown: Column<Subject>[] = [
    { id: 'username', header: 'Username', isRowHeader: true, cell: nameOf },
    { id: 'email', header: 'Email', cell: (s) => s.email ?? '—' },
    {
      id: 'enabled',
      header: 'Status',
      cell: (s) =>
        s.enabled ? (
          <StatusTag tone="active">enabled</StatusTag>
        ) : (
          <StatusTag tone="danger">disabled</StatusTag>
        ),
    },
    {
      id: 'created_at',
      header: 'Created',
      secondary: true,
      cell: (s) => <Timestamp value={s.created_at} />,
    },
  ];
  return page.changeNeeds.length > 0
    ? shown
    : [
        ...shown,
        {
          id: 'revoke',
          header: 'Action',
          cell: (s) => {
            const only = page.onlyHolder?.id === s.id;
            return (
              <Button
                size="small"
                aria-label={`Revoke ${nameOf(s)}`}
                isDisabled={only || page.busy}
                onPress={() => {
                  page.startRevoke(s);
                }}
                {...(only ? { 'aria-describedby': reasonId } : {})}
              >
                Revoke
              </Button>
            );
          },
        },
      ];
}

function Grant({ page }: { page: SystemAdministrators }) {
  const heading = useId();
  const chosen = page.chosen;
  return (
    <section aria-labelledby={heading} className={styles.grant}>
      <h2 id={heading} className={styles.heading}>
        Grant to an existing subject
      </h2>
      <p className={styles.lead}>
        Choose a subject of <code>system</code> to give tenant-admin, which carries every capability
        and reaches every tenant. Nobody is given a password here.
      </p>
      <Picker
        label="Subject in system"
        noun={{ one: 'subject', other: 'subjects' }}
        picker={page.picker}
        idOf={(subject) => subject.id}
        nameOf={nameOf}
        detailOf={(subject) => subject.email ?? subject.type}
        unavailableOf={page.unavailableOf}
        capability="view-users"
        searchBy="username"
        selected={chosen === null ? [] : [chosen.id]}
        onChange={(ids) => {
          page.choose(ids[0] ?? null);
        }}
        selectionMode="single"
      />
      <div className={styles.actions}>
        <Button variant="primary" isDisabled={chosen === null || page.busy} onPress={page.grant}>
          {chosen === null ? 'Grant tenant-admin' : `Grant tenant-admin to ${nameOf(chosen)}`}
        </Button>
        <p role="status" aria-label="Last grant" className={styles.message}>
          {page.grantMessage}
        </p>
      </div>
    </section>
  );
}

function Capabilities({ canChange }: { canChange: boolean }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.grant}>
      <h2 id={heading} className={styles.heading}>
        Every admin capability in system
      </h2>
      <p className={styles.lead}>
        Everybody in <code>system</code> holding any admin capability, Full or a part of it, with
        what each holds and how. A capability held only in <code>system</code> reaches no other
        tenant unless it is manage-tenants.
      </p>
      <CapabilityHolders tenant={SYSTEM_TENANT} canChange={canChange} />
    </section>
  );
}

function Problem({ problem }: { problem: RevokeProblem }) {
  if (problem.kind === 'refused') return problem.text;
  return (
    <>
      {`Nothing was changed: ${problem.name} holds manage-tenants only through a group or a role that nests it. Change that group or role on ${problem.name}’s `}
      <Link href={problem.groupsHref}>Groups</Link> or <Link href={problem.rolesHref}>Roles</Link>{' '}
      tab.
    </>
  );
}

function problemOf(revoking: SystemAdministrators['revoking']) {
  const problem = revoking?.problem ?? null;
  return problem === null ? undefined : <Problem problem={problem} />;
}

function Administrators() {
  const page = useSystemAdministratorsPage();
  const reasonId = useId();
  const { list, begin, revoking } = page;
  return (
    <>
      <ResourceListPage
        list={list}
        kicker="System"
        title={TITLE}
        description="Everybody in system who holds manage-tenants, directly, through a group or under another role, and so reaches every tenant. A change that would leave system with no enabled one is refused."
        {...(page.createNeeds.length > 0
          ? {}
          : {
              actions: (
                <Button variant="primary" onPress={begin.start}>
                  Create a system administrator
                </Button>
              ),
            })}
        {...(page.blocked === null
          ? {}
          : {
              viewOnly: (
                <ViewOnlyNote
                  noun="system administrators"
                  change={page.blocked.change}
                  needs={page.blocked.needs}
                />
              ),
            })}
        noun={NOUN}
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
        columns={columns(page, reasonId)}
        rowKey={(subject) => subject.id}
        capability="view-users"
        nothingYet="Nobody in system holds manage-tenants, so only odudu seed admin can make one."
        notice={
          <p role="status" aria-label="Last revoke" className={styles.message}>
            {page.revokeNotice}
          </p>
        }
      />
      <div className={styles.after}>
        {page.onlyHolder === null ? null : (
          <p id={reasonId} className={styles.reason}>
            {page.onlyHolder.reason}
          </p>
        )}
        {list.status === 'ready' && page.changeNeeds.length === 0 ? <Grant page={page} /> : null}
        <Capabilities canChange={page.capabilityNeeds.length === 0} />
      </div>
      <ConfirmDialog
        isOpen={revoking !== null}
        title={revoking?.title ?? ''}
        consequence={revoking?.consequence ?? ''}
        confirmLabel="Revoke"
        tone="danger"
        typed={revoking?.typed ?? ''}
        busy={page.busy}
        problem={problemOf(revoking)}
        settled={revoking?.problem?.kind === 'not-direct'}
        onConfirm={page.confirmRevoke}
        onCancel={page.cancelRevoke}
      />
    </>
  );
}

export function SystemAdministratorsPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate tenant={tenant} title={TITLE}>
      <Administrators />
    </SystemGate>
  );
}
