import type { GroupRecord } from '@odudu/contracts/admin';
import { useId } from 'react';
import { NAME_FIXED } from '#/features/groups/service.ts';
import {
  useGroupGeneral,
  type Defaults,
  type Deletion,
  type GroupGeneral,
  type Place,
} from '#/features/groups/usecase/useGroupGeneral.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import { SectionNoticeOf } from '#/features/groups/view/SectionNoticeOf';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { TextAreaField, ToggleField } from '#/shared/view/Field';
import { GroupPicker } from '#/shared/view/GroupPicker';
import { Section } from '#/shared/view/Section';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/groups/view/GroupRecordPage/Tab.module.css';

function Fixed({ group }: { group: GroupRecord }) {
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
            <code>{group.name}</code>
          </dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>
            <code>{group.path}</code>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={group.created_at} />
          </dd>
        </div>
      </dl>
      <p className={styles.rule}>{NAME_FIXED}</p>
    </section>
  );
}

function Description({ general }: { general: GroupGeneral }) {
  const s = general.description;
  return (
    <Section
      title="Description"
      description="What the group is for, shown wherever it is chosen."
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

function PlaceSection({ place }: { place: Place }) {
  const s = place.save;
  return (
    <Section
      title="Place in the tree"
      description="Its members receive the roles of every group above it, so a move changes what they hold."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Place in the tree" save={s} />}
    >
      <p className={styles.text}>{place.current}</p>
      {place.state === 'checking' ? (
        <p className={styles.rule}>Checking what the groups above it hand down…</p>
      ) : null}
      {place.state === 'ready' && place.held === null ? (
        <>
          <GroupPicker
            label="Parent"
            picker={place.picker}
            selected={s.values.parent_id === null ? [] : [s.values.parent_id]}
            onChange={place.choose}
            selectionMode="single"
            unavailableOf={place.unavailableOf}
          />
          <p className={styles.rule}>Choose the parent again to move it to the top level.</p>
        </>
      ) : null}
      <ConfirmDialog
        isOpen={place.asking !== null}
        title={place.asking?.title ?? ''}
        consequence={place.asking?.consequence ?? ''}
        confirmLabel="Save Place in the tree"
        tone="danger"
        onConfirm={place.confirm}
        onCancel={place.cancel}
      />
    </Section>
  );
}

function DefaultSection({ defaults }: { defaults: Defaults }) {
  const s = defaults.save;
  let body;
  if (defaults.state === 'checking') {
    body = <p className={styles.rule}>Checking what it hands out…</p>;
  } else if (defaults.state === 'failed') {
    body = null;
  } else if (defaults.fixed === null) {
    body = (
      <ToggleField
        label="Joined by every new subject"
        description="Every subject created from now on joins it, by the admin API, registration and seeding alike. Nobody who already exists is changed."
        value={s.values.default_for_new_subjects}
        changed={s.changed.includes('default_for_new_subjects')}
        onChange={(value) => {
          s.edit('default_for_new_subjects', value);
        }}
      />
    );
  } else {
    body = <p className={styles.rule}>{defaults.fixed}</p>;
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

// Left out where the ceiling rules it out; the page's one line says why.
function Danger({ path, deletion }: { path: string; deletion: Deletion }) {
  const heading = useId();
  if (deletion.held !== null || deletion.state === 'failed') return null;
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Delete
      </h2>
      <p className={styles.text}>
        A delete takes the whole subtree: no group beneath it survives as a new top-level group.
      </p>
      {deletion.state === 'checking' ? (
        <p className={styles.rule}>Checking what its members hold through it…</p>
      ) : (
        <div className={styles.actions}>
          <Button variant="danger" onPress={deletion.ask}>
            {`Delete ${path} and every group beneath it`}
          </Button>
        </div>
      )}
      <ConfirmDialog
        isOpen={deletion.confirming}
        title={`Delete ${path}?`}
        consequence={deletion.consequence}
        confirmLabel={`Delete ${path}`}
        tone="danger"
        typed={path}
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
  group,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  group: GroupRecord;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}) {
  const general = useGroupGeneral({ tenant, group, etag, gone, ceiling });
  return (
    <div className={styles.tab}>
      <Fixed group={group} />
      <Description general={general} />
      <PlaceSection place={general.place} />
      <DefaultSection defaults={general.defaults} />
      <Danger path={group.path} deletion={general.deletion} />
    </div>
  );
}
