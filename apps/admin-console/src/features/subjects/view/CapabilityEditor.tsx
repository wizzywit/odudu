import type { Subject } from '@odudu/contracts/admin';
import {
  useCapabilityEditor,
  useSubjectRolesRead,
  type CapabilityEditing,
} from '#/features/subjects/usecase/useCapabilities.ts';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { ChecklistField } from '#/shared/view/ChecklistField.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { FormSkeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

function beyondText(name: string, beyond: readonly string[]): string {
  const list =
    beyond.length === 1
      ? beyond[0]
      : `${beyond.slice(0, -1).join(', ')} and ${String(beyond.at(-1))}`;
  return `${name} holds ${String(list)}, which you do not, so you cannot change what ${name} holds (ADR 0040).`;
}

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
      {locked ? <p className={styles.rule}>{beyondText(editing.name, editing.beyond)}</p> : null}
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
    </Section>
  );
}

function Ready({
  tenant,
  subject,
  authorityTenant,
  ...read
}: {
  tenant: string;
  subject: Subject;
  authorityTenant: string;
  data: Parameters<typeof useCapabilityEditor>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const editing = useCapabilityEditor({ tenant, subject, authorityTenant, ...read });
  return <CapabilitySection editing={editing} />;
}

// A subject's admin capabilities on their own, wherever its holders are listed.
export function SubjectCapabilities({
  tenant,
  subject,
  authorityTenant = tenant,
}: {
  tenant: string;
  subject: Subject;
  authorityTenant?: string;
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
      data={read.data}
      etag={read.etag}
      gone={read.gone}
    />
  );
}
