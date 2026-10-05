import type { Subject } from '@odudu/contracts/admin';
import { REQUIRED_ACTIONS, signsInAsItself } from '#/features/subjects/service.ts';
import {
  useRequiredActions,
  useRequiredActionsRead,
} from '#/features/subjects/usecase/useRequiredActions.ts';
import { SectionNoticeOf } from '#/features/subjects/view/SectionNoticeOf.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { ChecklistField } from '#/shared/view/ChecklistField.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { ReadOnlyFields } from '#/shared/view/Field.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { FormSkeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/features/subjects/view/Tab.module.css';

const OPTIONS = REQUIRED_ACTIONS.map(({ action, label, description }) => ({
  id: action,
  label,
  description,
}));

function Ready({
  tenant,
  subject,
  ...read
}: {
  tenant: string;
  subject: Subject;
  data: Parameters<typeof useRequiredActions>[2];
  etag: string;
  gone: boolean;
}) {
  const {
    name,
    canManage,
    save: s,
    choose,
  } = useRequiredActions(tenant, subject, read.data, read.etag, read.gone);
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

function Panel({ tenant, subject }: { tenant: string; subject: Subject }) {
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
    <Ready tenant={tenant} subject={subject} data={read.data} etag={read.etag} gone={read.gone} />
  );
}

export function RequiredActionsTab({ tenant, subject }: { tenant: string; subject: Subject }) {
  return (
    <div className={styles.tab}>
      {signsInAsItself(subject) ? (
        <p className={styles.text}>
          {`A ${subject.type} subject signs in as itself, with its client's credentials, so it is asked for nothing at sign-in.`}
        </p>
      ) : (
        <Panel tenant={tenant} subject={subject} />
      )}
    </div>
  );
}
