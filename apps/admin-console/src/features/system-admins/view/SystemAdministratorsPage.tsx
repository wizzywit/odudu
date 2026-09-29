import type { Subject } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  useSystemAdministratorsPage,
  type SystemAdministrators,
} from '#/features/system-admins/usecase/useSystemAdministratorsPage.ts';
import { ReplaceUnfinished, SystemGate } from '#/features/tenants/index.ts';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import type { Column } from '#/shared/view/DataTable.tsx';
import { SelectField } from '#/shared/view/Field.tsx';
import { Picker } from '#/shared/view/Picker.tsx';
import { ResourceListPage } from '#/shared/view/ResourceListPage.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
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
  return [
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
    {
      id: 'revoke',
      header: 'Action',
      cell: (s) => {
        const only = page.onlyHolder?.id === s.id;
        return (
          <Button
            size="small"
            aria-label={`Revoke ${nameOf(s)}`}
            isDisabled={only || page.changeNeeds.length > 0 || page.busy}
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
        capability="view-users"
        searchBy="username"
        selected={chosen === null ? [] : [chosen.id]}
        onChange={(ids) => {
          page.choose(ids[0] ?? null);
        }}
        selectionMode="single"
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          isDisabled={chosen === null || page.changeNeeds.length > 0 || page.busy}
          onPress={page.grant}
        >
          {chosen === null ? 'Grant tenant-admin' : `Grant tenant-admin to ${nameOf(chosen)}`}
        </Button>
      </div>
    </section>
  );
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
        actions={
          <Button variant="primary" onPress={begin.start} isDisabled={page.createNeeds.length > 0}>
            Create a system administrator
          </Button>
        }
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
      />
      <div className={styles.after}>
        <p role="status" className={styles.message}>
          {page.message}
        </p>
        {page.onlyHolder === null ? null : (
          <p id={reasonId} className={styles.reason}>
            {page.onlyHolder.reason}
          </p>
        )}
        {page.createNeeds.map((capability) => (
          <CapabilityNote key={capability} capability={capability}>
            Creating a system administrator
          </CapabilityNote>
        ))}
        {page.changeNeeds.map((capability) => (
          <CapabilityNote key={capability} capability={capability}>
            Granting or revoking tenant-admin
          </CapabilityNote>
        ))}
        {list.status === 'ready' ? <Grant page={page} /> : null}
      </div>
      <ConfirmDialog
        isOpen={revoking !== null}
        title={revoking?.title ?? ''}
        consequence={revoking?.consequence ?? ''}
        confirmLabel="Revoke"
        tone="danger"
        typed={revoking?.typed ?? ''}
        busy={page.busy}
        onConfirm={page.confirmRevoke}
        onCancel={page.cancelRevoke}
      />
      <ReplaceUnfinished begin={begin} />
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
