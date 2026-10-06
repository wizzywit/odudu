import type { Role } from '@odudu/contracts/admin';
import { useId } from 'react';
import { NAME_FIXED } from '#/features/roles/service';
import {
  useRoleGeneral,
  type Defaults,
  type Deletion,
  type RoleGeneral,
} from '#/features/roles/usecase/useRoleGeneral.ts';
import type { Ceiling } from '#/features/roles/usecase/useRoleRecordPage.ts';
import { RoleOwner } from '#/shared/view/RoleOwner';
import { SectionNoticeOf } from '#/shared/view/SectionNoticeOf';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { TextAreaField, ToggleField } from '#/shared/view/Field';
import { Section } from '#/shared/view/Section';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/roles/view/RoleRecordPage/Tab.module.css';

function Fixed({ role }: { role: Role }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Name
      </h2>
      <dl className={styles.fixed}>
        <div>
          <dt>Name</dt>
          <dd>
            <code>{role.name}</code>
          </dd>
        </div>
        <div>
          <dt>Belongs to</dt>
          <dd>
            <RoleOwner role={role} />
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={role.created_at} />
          </dd>
        </div>
      </dl>
      <p className={styles.rule}>{NAME_FIXED}</p>
    </section>
  );
}

function Description({ general }: { general: RoleGeneral }) {
  const s = general.description;
  return (
    <Section
      title="Description"
      description="What the role is for, shown wherever it is chosen."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Description" save={s} />}
    >
      <TextAreaField
        label="Description"
        description={general.descriptionRule}
        limit={general.descriptionLimit}
        value={s.values.description}
        error={s.fieldErrors.description}
        changed={s.changed.includes('description')}
        onChange={(value) => {
          s.edit('description', value);
        }}
      />
    </Section>
  );
}

function DefaultSection({ defaults }: { defaults: Defaults }) {
  const s = defaults.save;
  let body;
  if (defaults.fixed !== null) {
    body = <p className={styles.rule}>{defaults.fixed}</p>;
  } else if (defaults.checking) {
    body = <p className={styles.rule}>Checking what it nests…</p>;
  } else {
    body = (
      <ToggleField
        label="Given to every new subject"
        description="Every subject created from now on is given it, by the admin API, registration and seeding alike. Nobody who already exists is changed, and turning it off takes it from nobody."
        value={s.values.default_for_new_subjects}
        changed={s.changed.includes('default_for_new_subjects')}
        onChange={(value) => {
          s.edit('default_for_new_subjects', value);
        }}
      />
    );
  }
  return (
    <Section
      title="New subjects"
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="New subjects" save={s} />}
    >
      {body}
    </Section>
  );
}

// Left out where the ceiling rules it out, which the page's one line says.
function Danger({ name, deletion }: { name: string; deletion: Deletion }) {
  const heading = useId();
  if (deletion.held) return null;
  let action;
  if (deletion.fixed !== null) {
    action = <p className={styles.rule}>{deletion.fixed}</p>;
  } else if (deletion.checking) {
    action = <p className={styles.rule}>Checking what it nests…</p>;
  } else {
    action = (
      <div className={styles.actions}>
        <Button variant="danger" onPress={deletion.ask}>
          {`Delete ${name}`}
        </Button>
      </div>
    );
  }
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Delete
      </h2>
      {action}
      <ConfirmDialog
        isOpen={deletion.confirming}
        title={`Delete ${name}?`}
        consequence={deletion.consequence}
        confirmLabel={`Delete ${name}`}
        tone="danger"
        busy={deletion.busy}
        problem={deletion.problem}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </section>
  );
}

export function GeneralTab({
  tenant,
  role,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  role: Role;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}) {
  const general = useRoleGeneral({ tenant, role, etag, gone, ceiling });
  return (
    <div className={styles.tab}>
      <Fixed role={role} />
      <Description general={general} />
      <DefaultSection defaults={general.defaults} />
      <Danger name={role.name} deletion={general.deletion} />
    </div>
  );
}
