import type { EffectiveRoleAssignment, Subject } from '@odudu/contracts/admin';
import { useId } from 'react';
import { roleOwnerOf } from '#/features/subjects/service';
import {
  useCapabilityEditor,
  useSubjectRolesRead,
} from '#/features/subjects/usecase/useCapabilities.ts';
import { useSubjectRoles, type SubjectRoles } from '#/features/subjects/usecase/useSubjectRoles.ts';
import { CapabilitySection } from '#/features/subjects/view/SubjectRecordPage/CapabilityEditor.tsx';
import { SectionNoticeOf } from '#/shared/view/SectionNoticeOf';
import { PagedList } from '#/features/subjects/view/SubjectRecordPage/SessionsTab.tsx';
import { provenanceText } from '#/shared/service/capabilities';
import { Button } from '#/shared/view/Button';
import type { Column } from '#/shared/view/DataTable';
import { EmptyState } from '#/shared/view/EmptyState';
import { RolePicker } from '#/shared/view/RolePicker';
import { Section } from '#/shared/view/Section';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/subjects/view/SubjectRecordPage/Tab.module.css';

const EFFECTIVE: readonly Column<EffectiveRoleAssignment>[] = [
  { id: 'name', header: 'Role', isRowHeader: true, cell: (role) => <code>{role.name}</code> },
  { id: 'owner', header: 'Belongs to', cell: (role) => roleOwnerOf(role.client_key) },
  { id: 'how', header: 'Held', cell: (role) => role.via.map(provenanceText).join(', ') },
];

function Effective({ roles }: { roles: SubjectRoles }) {
  const heading = useId();
  const body = (
    <PagedList
      list={roles.effective}
      label={`Every role ${roles.name} holds`}
      noun="roles held"
      columns={EFFECTIVE}
      rowKey={(role) => role.id}
      empty={`${roles.name} holds no role, directly or otherwise.`}
    />
  );
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
              <span className={styles.rule}>{` · ${roleOwnerOf(role.client)}`}</span>
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
  canManage,
  self,
  ...read
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
  self: boolean;
  data: Parameters<typeof useSubjectRoles>[2];
  etag: string;
  gone: boolean;
}) {
  const roles = useSubjectRoles(tenant, subject, read.data, read.etag, read.gone, canManage);
  const editing = useCapabilityEditor({ tenant, subject, allowed: canManage, self, ...read });
  return (
    <>
      <Roles roles={roles} />
      <CapabilitySection editing={editing} />
      <Effective roles={roles} />
    </>
  );
}

export function RolesTab({
  tenant,
  subject,
  canManage,
  self,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
  self: boolean;
}) {
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
      <Ready
        tenant={tenant}
        subject={subject}
        canManage={canManage}
        self={self}
        data={read.data}
        etag={read.etag}
        gone={read.gone}
      />
    </div>
  );
}
