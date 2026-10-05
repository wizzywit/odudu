import type { Role } from '@odudu/contracts/admin';
import { useId, useRef } from 'react';
import {
  useCompositesRead,
  useRoleComposites,
  type RoleComposites,
} from '#/features/roles/usecase/useRoleComposites.ts';
import type { Ceiling } from '#/features/roles/usecase/useRoleRecordPage.ts';
import { RoleOwner } from '#/shared/view/RoleOwner';
import { SectionNoticeOf } from '#/features/roles/view/SectionNoticeOf.tsx';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { EmptyState } from '#/shared/view/EmptyState';
import { RolePicker } from '#/shared/view/RolePicker';
import { Section } from '#/shared/view/Section';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/roles/view/Tab.module.css';

function Nested({ role, composites }: { role: Role; composites: RoleComposites }) {
  const heading = useId();
  const named = useRef<HTMLHeadingElement>(null);
  const editable = composites.fixed === null && composites.offered;
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} ref={named} tabIndex={-1} className={styles.heading}>
        Nested in it
      </h2>
      <p className={styles.rule}>
        {composites.fixed ??
          `Whoever holds ${role.name} holds each of these too, and what each of them nests in turn.`}
      </p>
      {composites.children.length === 0 ? (
        <p className={styles.rule}>{`${role.name} nests no role.`}</p>
      ) : (
        <ul aria-label={`Nested in ${role.name}`} className={styles.roles}>
          {composites.children.map(({ role: child, held }) => (
            <li key={child.id} className={styles.child}>
              <code>{child.name}</code> <RoleOwner role={child} />
              {child.description === null || child.description === '' ? null : (
                <span className={styles.rule}>{child.description}</span>
              )}
              {!editable ? null : held === null ? (
                <Button
                  size="small"
                  variant="quiet"
                  isDisabled={composites.removing !== null}
                  onPress={() => {
                    composites
                      .remove(child)
                      .then((gone) => {
                        if (gone) named.current?.focus();
                      })
                      .catch(() => undefined);
                  }}
                >
                  {composites.removing === child.id
                    ? `Taking out ${child.name}…`
                    : `Take ${child.name} out`}
                </Button>
              ) : (
                <span className={styles.rule}>{held}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className={styles.message}>
        {composites.message}
      </p>
      <ConfirmDialog
        isOpen={composites.asking !== null}
        title={composites.asking?.title ?? ''}
        consequence={composites.asking?.consequence ?? ''}
        confirmLabel="Take it out"
        tone="danger"
        onConfirm={composites.confirm}
        onCancel={composites.cancel}
      />
    </section>
  );
}

function Add({ role, composites }: { role: Role; composites: RoleComposites }) {
  const s = composites.add;
  return (
    <Section
      title="Add a composite"
      saveLabel={`Nest it in ${role.name}`}
      description={`Nests one more role in ${role.name}; whoever holds ${role.name} holds it from their next token.`}
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Add a composite" save={s} />}
    >
      {composites.offered ? (
        <RolePicker
          label={`Role to nest in ${role.name}`}
          picker={composites.picker}
          selected={s.values.child_role_id === null ? [] : [s.values.child_role_id]}
          unavailableOf={composites.unavailableOf}
          onChange={composites.choose}
          selectionMode="single"
        />
      ) : (
        <p className={styles.rule}>Checking what you may nest here…</p>
      )}
    </Section>
  );
}

function Ready({
  tenant,
  role,
  ceiling,
  ...read
}: {
  tenant: string;
  role: Role;
  ceiling: Ceiling;
  data: Parameters<typeof useRoleComposites>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const composites = useRoleComposites({ tenant, role, ceiling, ...read });
  return (
    <>
      <Nested role={role} composites={composites} />
      {composites.fixed === null ? <Add role={role} composites={composites} /> : null}
    </>
  );
}

export function CompositesTab({
  tenant,
  role,
  ceiling,
}: {
  tenant: string;
  role: Role;
  ceiling: Ceiling;
}) {
  const read = useCompositesRead(tenant, role.id);
  if (read.status === 'loading') return <FormSkeleton label="Loading the composites" fields={2} />;
  if (read.data === undefined || read.etag === null) {
    return (
      <EmptyState
        variant="failed"
        title="The composites could not be loaded"
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
        role={role}
        ceiling={ceiling}
        data={read.data}
        etag={read.etag}
        gone={read.gone}
      />
    </div>
  );
}
