import type { Group } from '@odudu/contracts/admin';
import {
  useGroupRoles,
  useGroupRolesRead,
  type GroupRoles,
  type Mapped,
} from '#/features/groups/usecase/useGroupRoles.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import { SectionNoticeOf } from '#/features/groups/view/SectionNoticeOf.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { RolePicker } from '#/shared/view/RolePicker.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { FormSkeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/groups/view/Tab.module.css';

// A client's role reaches a token under its client's name, so it is told
// apart from a tenant role of the same name by more than colour.
export function Owner({ client }: { client: string | null }) {
  return client === null ? (
    <StatusTag tone="neutral">tenant role</StatusTag>
  ) : (
    <StatusTag tone="neutral">{`client ${client}`}</StatusTag>
  );
}

function Listed({ path, mapped }: { path: string; mapped: readonly Mapped[] }) {
  if (mapped.length === 0) return <p className={styles.rule}>{`${path} carries no role.`}</p>;
  return (
    <ul aria-label={`Carried by ${path}`} className={styles.roles}>
      {mapped.map((role) => (
        <li key={role.id}>
          <code>{role.name}</code> <Owner client={role.client} />
          {role.description === null || role.description === '' ? null : (
            <span className={styles.rule}>{` ${role.description}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Roles({ path, roles }: { path: string; roles: GroupRoles }) {
  const s = roles.save;
  return (
    <Section
      title="Roles"
      description={`Every role here is held by each member of ${path} and of every group beneath it.`}
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Roles" save={s} />}
    >
      <Listed path={path} mapped={roles.mapped} />
      {roles.offered ? (
        <RolePicker
          label={`Roles ${path} carries`}
          picker={roles.picker}
          selected={s.values.role_ids}
          unavailableOf={roles.unavailableOf}
          onChange={roles.choose}
        />
      ) : (
        <p className={styles.rule}>Checking what you may give or take here…</p>
      )}
      {roles.kept.length === 0 ? null : (
        <p className={styles.rule}>
          A role you could not give is one you cannot take away either, so it stays whatever else is
          saved.
        </p>
      )}
      <ConfirmDialog
        isOpen={roles.asking !== null}
        title={roles.asking?.title ?? ''}
        consequence={roles.asking?.consequence ?? ''}
        confirmLabel="Save Roles"
        tone="danger"
        onConfirm={roles.confirm}
        onCancel={roles.cancel}
      />
    </Section>
  );
}

function Ready({
  tenant,
  group,
  ceiling,
  ...read
}: {
  tenant: string;
  group: Group;
  ceiling: Ceiling;
  data: Parameters<typeof useGroupRoles>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const roles = useGroupRoles({ tenant, group, ceiling, ...read });
  return <Roles path={group.path} roles={roles} />;
}

export function RolesTab({
  tenant,
  group,
  ceiling,
}: {
  tenant: string;
  group: Group;
  ceiling: Ceiling;
}) {
  const read = useGroupRolesRead(tenant, group.id);
  if (read.status === 'loading') return <FormSkeleton label="Loading the roles" fields={2} />;
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
        group={group}
        ceiling={ceiling}
        data={read.data}
        etag={read.etag}
        gone={read.gone}
      />
    </div>
  );
}
