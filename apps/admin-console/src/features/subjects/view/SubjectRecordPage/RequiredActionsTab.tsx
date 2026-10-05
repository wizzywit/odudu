import type { Subject } from '@odudu/contracts/admin';
import { REQUIRED_ACTIONS, signsInAsItself } from '#/features/subjects/service.ts';
import {
  useRequiredActions,
  useRequiredActionsRead,
} from '#/features/subjects/usecase/useRequiredActions.ts';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf';
import { Button } from '#/shared/view/Button';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { EmptyState } from '#/shared/view/EmptyState';
import { ReadOnlyFields } from '#/shared/view/Field';
import { Section } from '#/shared/view/Section';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/subjects/view/SubjectRecordPage/Tab.module.css';

const OPTIONS = REQUIRED_ACTIONS.map(({ action, label, description }) => ({
  id: action,
  label,
  description,
}));

function Ready({
  tenant,
  subject,
  allowed,
  ...read
}: {
  tenant: string;
  subject: Subject;
  allowed: boolean;
  data: Parameters<typeof useRequiredActions>[2];
  etag: string;
  gone: boolean;
}) {
  const {
    name,
    canManage,
    save: s,
    choose,
  } = useRequiredActions(tenant, subject, read.data, read.etag, read.gone, allowed);
  return (
    <Section
      title="Required actions"
      description={`What ${name}'s next sign-in asks for, in this order, before it lets them in. Each is cleared once done.`}
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Required actions" save={s} />}
    >
      <ReadOnlyFields when={!canManage}>
        <ChecklistField
          label={`Asked of ${name}`}
          options={OPTIONS}
          value={s.values.actions}
          changed={s.changed.includes('actions')}
          onChange={choose}
        />
      </ReadOnlyFields>
    </Section>
  );
}

function Panel({
  tenant,
  subject,
  canManage,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
}) {
  const read = useRequiredActionsRead(tenant, subject.id);
  if (read.status === 'loading') {
    return <FormSkeleton label="Loading the required actions" fields={2} />;
  }
  if (read.data === undefined || read.etag === null) {
    return (
      <EmptyState
        variant="failed"
        title="The required actions could not be loaded"
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
      allowed={canManage}
      data={read.data}
      etag={read.etag}
      gone={read.gone}
    />
  );
}

export function RequiredActionsTab({
  tenant,
  subject,
  canManage,
}: {
  tenant: string;
  subject: Subject;
  canManage: boolean;
}) {
  return (
    <div className={styles.tab}>
      {signsInAsItself(subject) ? (
        <p className={styles.text}>
          {`A ${subject.type} subject signs in as itself, with its client's credentials, so it is asked for nothing at sign-in.`}
        </p>
      ) : (
        <Panel tenant={tenant} subject={subject} canManage={canManage} />
      )}
    </div>
  );
}
