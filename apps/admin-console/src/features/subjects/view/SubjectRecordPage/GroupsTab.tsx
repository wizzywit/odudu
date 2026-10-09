import type { Subject } from '@odudu/contracts/admin';
import {
  useSubjectGroups,
  useSubjectGroupsRead,
  type Membership,
  type SubjectGroups,
} from '#/features/subjects/usecase/useSubjectGroups.ts';
import { SectionNoticeOf } from '#/shared/view/SectionNoticeOf';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { EmptyState } from '#/shared/view/EmptyState';
import { GroupPicker } from '#/shared/view/GroupPicker';
import { Section } from '#/shared/view/Section';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/subjects/view/SubjectRecordPage/Tab.module.css';

export function Memberships({ name, members }: { name: string; members: readonly Membership[] }) {
  if (members.length === 0) return <p className={styles.rule}>{`${name} belongs to no group.`}</p>;
  return (
    <ul aria-label={`${name} belongs to`} className={styles.list}>
      {members.map((member) => (
        <li key={member.id}>
          <code>{member.path}</code>
          {member.description === null ? null : (
            <span className={styles.rule}>{` · ${member.description}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Groups({ groups }: { groups: SubjectGroups }) {
  const s = groups.save;
  return (
    <Section
      title="Groups"
      description="Direct memberships, which the groups claim of the next token carries. Joining a group grants its roles, and its ancestors' roles too."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Groups" save={s} />}
    >
      <Memberships name={groups.name} members={groups.members} />
      {groups.canManage ? (
        <GroupPicker
          label={`Groups ${groups.name} belongs to`}
          picker={groups.picker}
          selected={s.values.group_ids}
          onChange={groups.choose}
        />
      ) : null}
      <ConfirmDialog
        isOpen={groups.confirming !== null}
        title={groups.confirming?.title ?? ''}
        consequence={groups.confirming?.consequence ?? ''}
        confirmLabel="Save Groups"
        tone="danger"
        {...(typeof groups.confirming?.typed === 'string'
          ? { typed: groups.confirming.typed }
          : {})}
        onConfirm={groups.confirm}
        onCancel={groups.cancel}
      />
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
  data: Parameters<typeof useSubjectGroups>[2];
  etag: string;
  gone: boolean;
}) {
  const groups = useSubjectGroups(
    tenant,
    subject,
    read.data,
    read.etag,
    read.gone,
    canManage,
    self,
  );
  return <Groups groups={groups} />;
}

export function GroupsTab({
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
  const read = useSubjectGroupsRead(tenant, subject.id);
  if (read.status === 'loading') return <FormSkeleton label="Loading the groups" fields={2} />;
  if (read.data === undefined || read.etag === null) {
    return (
      <EmptyState
        variant="failed"
        title="The groups could not be loaded"
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
