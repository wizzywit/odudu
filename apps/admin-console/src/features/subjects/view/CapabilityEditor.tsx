import type { Subject } from '@odudu/contracts/admin';
import {
  useCapabilityEditor,
  useSubjectRolesRead,
  type CapabilityEditing,
} from '#/features/subjects/usecase/useCapabilities.ts';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf.tsx';
import { Link } from 'react-aria-components';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { EmptyState } from '#/shared/view/EmptyState';
import { ReadOnlyFields } from '#/shared/view/Field';
import { Section } from '#/shared/view/Section';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/subjects/view/Tab.module.css';

export function CapabilitySection({ editing }: { editing: CapabilityEditing }) {
  const s = editing.save;
  const locked = editing.canManage && editing.beyond.length > 0;
  return (
    <Section
      title="Admin capabilities"
      description="What this subject may do through the admin API and this console, assigned to the subject itself. Holdings through a group or another role are named beside each, and change where they come from."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Admin capabilities" save={s} />}
    >
      {locked ? <p className={styles.rule}>{editing.beyondText}</p> : null}
      {editing.rolesFailed === null ? null : (
        <p role="alert" className={styles.rule}>
          The admin roles could not be read, so nothing can be saved.{' '}
          <Button size="small" variant="quiet" onPress={editing.rolesFailed.retry}>
            Read them again
          </Button>
        </p>
      )}
      <ReadOnlyFields when={!editing.canManage}>
        <ChecklistField
          label={`Assigned to ${editing.name}`}
          options={editing.options}
          value={s.values.capabilities}
          changed={s.changed.includes('capabilities')}
          isDisabled={locked}
          onChange={editing.choose}
        />
      </ReadOnlyFields>
      {editing.elsewhere.length === 0 ? null : (
        <p className={styles.rule}>
          {editing.elsewhereText}
          <Link href={editing.groupsHref}>Groups</Link> or{' '}
          <Link href={editing.rolesHref}>Roles</Link> tab.
        </p>
      )}
      <ConfirmDialog
        isOpen={editing.confirming !== null}
        title={editing.confirming?.title ?? ''}
        consequence={editing.confirming?.consequence ?? ''}
        confirmLabel="Save Admin capabilities"
        tone="danger"
        {...(typeof editing.confirming?.typed === 'string'
          ? { typed: editing.confirming.typed }
          : {})}
        onConfirm={editing.confirm}
        onCancel={editing.cancel}
      />
    </Section>
  );
}

function Ready({
  tenant,
  subject,
  authorityTenant,
  self,
  ...read
}: {
  tenant: string;
  subject: Subject;
  authorityTenant: string;
  self: boolean;
  data: Parameters<typeof useCapabilityEditor>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const editing = useCapabilityEditor({ tenant, subject, authorityTenant, self, ...read });
  return <CapabilitySection editing={editing} />;
}

// A subject's admin capabilities on their own, wherever its holders are listed.
export function SubjectCapabilities({
  tenant,
  subject,
  authorityTenant = tenant,
  self,
}: {
  tenant: string;
  subject: Subject;
  authorityTenant?: string;
  self: boolean;
}) {
  const read = useSubjectRolesRead(tenant, subject.id);
  if (read.status === 'loading') {
    return <FormSkeleton label="Loading the admin capabilities" fields={2} />;
  }
  if (read.data === undefined || read.etag === null) {
    return (
      <EmptyState
        variant="failed"
        title="The admin capabilities could not be loaded"
        action={<Button onPress={read.retry}>Try again</Button>}
      >
        The gateway did not answer, or answered with an error.
      </EmptyState>
    );
  }
  return (
    <Ready
      tenant={tenant}
      subject={subject}
      authorityTenant={authorityTenant}
      self={self}
      data={read.data}
      etag={read.etag}
      gone={read.gone}
    />
  );
}
