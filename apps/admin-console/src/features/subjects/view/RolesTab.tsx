import type { EffectiveRoleAssignment, Subject } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  useCapabilityEditor,
  useSubjectRolesRead,
} from '#/features/subjects/usecase/useCapabilities.ts';
import { useSubjectRoles, type SubjectRoles } from '#/features/subjects/usecase/useSubjectRoles.ts';
import { CapabilitySection } from '#/features/subjects/view/CapabilityEditor.tsx';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf.tsx';
import { provenanceText } from '#/shared/service/capabilities.ts';
import { Button } from '#/shared/view/Button.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { RolePicker } from '#/shared/view/RolePicker.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { FormSkeleton, TableSkeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

function ownerOf(client: string | null): string {
  return client === null ? 'tenant role' : `client ${client}`;
}

const EFFECTIVE: readonly Column<EffectiveRoleAssignment>[] = [
  { id: 'name', header: 'Role', isRowHeader: true, cell: (role) => <code>{role.name}</code> },
  { id: 'owner', header: 'Belongs to', cell: (role) => ownerOf(role.client_key) },
  { id: 'how', header: 'Held', cell: (role) => role.via.map(provenanceText).join(', ') },
];

function Effective({ roles }: { roles: SubjectRoles }) {
  const heading = useId();
  const read = roles.effective;
  let body;
  if (read.status === 'loading') {
    body = <TableSkeleton label="Loading every role held" columns={EFFECTIVE} rows={2} />;
  } else if (read.status === 'failed') {
    body = (
      <EmptyState
        variant="failed"
        title="The roles held could not be loaded"
        action={<Button onPress={read.retry}>Try again</Button>}
      >
        The gateway did not answer, or answered with an error.
      </EmptyState>
    );
  } else {
    body = (
      <DataTable
        label={`Every role ${roles.name} holds`}
        columns={EFFECTIVE}
        rows={read.data.items}
        rowKey={(role) => role.id}
        empty={`${roles.name} holds no role, directly or otherwise.`}
      />
    );
  }
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Held, every way
      </h2>
      <p className={styles.rule}>
        What a token and every authorisation read: the roles assigned here, those of every group and
        its ancestors, and each role nested inside another.
      </p>
      {body}
    </section>
  );
}

function Roles({ roles }: { roles: SubjectRoles }) {
  const s = roles.save;
  return (
    <Section
      title="Roles"
      description="The roles assigned to the subject itself, other than its admin capabilities."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Roles" save={s} />}
    >
      {roles.assigned.length === 0 ? (
        <p className={styles.rule}>{`${roles.name} is assigned no role here.`}</p>
      ) : (
        <ul aria-label={`Assigned to ${roles.name}`} className={styles.list}>
          {roles.assigned.map((role) => (
            <li key={role.id}>
              <code>{role.name}</code>
              <span className={styles.rule}>{` · ${ownerOf(role.client)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {roles.canManage ? (
        <RolePicker
          label={`Roles ${roles.name} holds directly`}
          picker={roles.picker}
          selected={s.values.role_ids}
          unavailableOf={roles.unavailableOf}
          onChange={roles.choose}
        />
      ) : null}
    </Section>
  );
}

function Ready({
  tenant,
  subject,
  ...read
}: {
  tenant: string;
  subject: Subject;
  data: Parameters<typeof useSubjectRoles>[2];
  etag: string;
  gone: boolean;
}) {
  const roles = useSubjectRoles(tenant, subject, read.data, read.etag, read.gone);
  const editing = useCapabilityEditor({ tenant, subject, ...read });
  return (
    <>
      <Roles roles={roles} />
      <CapabilitySection editing={editing} />
      <Effective roles={roles} />
    </>
  );
}

export function RolesTab({ tenant, subject }: { tenant: string; subject: Subject }) {
  const read = useSubjectRolesRead(tenant, subject.id);
  if (read.status === 'loading') return <FormSkeleton label="Loading the roles" fields={3} />;
  if (read.data === undefined || read.etag === null) {
    return (
      <EmptyState
        variant="failed"
        title="The roles could not be loaded"
        action={<Button onPress={read.retry}>Try again</Button>}
      >
        The gateway did not answer, or answered with an error.
      </EmptyState>
    );
  }
  return (
    <div className={styles.tab}>
      <Ready tenant={tenant} subject={subject} data={read.data} etag={read.etag} gone={read.gone} />
    </div>
  );
}
