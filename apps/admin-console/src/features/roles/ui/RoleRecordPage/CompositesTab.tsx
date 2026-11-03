import type { Role } from '#/entities/role';
import {
  useCompositesRead,
  useRoleComposites,
  type RoleComposites,
} from '#/features/roles/use-cases/useRoleComposites';
import type { RoleCeiling } from '#/features/roles/use-cases/useRoleRecordPage';
import { LiveMessage } from '#/shared/ui/Message';
import { Panel, useHeadingFocus } from '#/shared/ui/Panel';
import { ReadGate } from '#/shared/ui/ReadGate';
import { RoleOwner } from '#/shared/ui/RoleOwner';
import { Button } from '#/shared/ui/Button';
import { AskedDialog } from '#/shared/ui/ConfirmDialog';
import { RolePicker } from '#/shared/ui/RolePicker';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/features/roles/ui/RoleRecordPage/Tab.module.css';

function Nested({ role, composites }: { role: Role; composites: RoleComposites }) {
  const { heading, afterRemoval } = useHeadingFocus();
  const editable = composites.fixed === null && composites.offered;
  return (
    <Panel title="Nested in it" headingRef={heading}>
      <p className={recordTab.rule}>
        {composites.fixed ??
          `Whoever holds ${role.name} holds each of these too, and what each of them nests in turn.`}
      </p>
      {composites.children.length === 0 ? (
        <p className={recordTab.rule}>{`${role.name} nests no role.`}</p>
      ) : (
        <ul aria-label={`Nested in ${role.name}`} className={recordTab.items}>
          {composites.children.map(({ role: child, held }) => (
            <li key={child.id} className={styles.child}>
              <code>{child.name}</code> <RoleOwner role={child} />
              {child.description === null || child.description === '' ? null : (
                <span className={recordTab.rule}>{child.description}</span>
              )}
              {!editable ? null : held === null ? (
                <Button
                  size="small"
                  variant="quiet"
                  isDisabled={composites.removing !== null}
                  onPress={() => {
                    afterRemoval(composites.remove(child)).catch(() => undefined);
                  }}
                >
                  {composites.removing === child.id
                    ? `Taking out ${child.name}…`
                    : `Take ${child.name} out`}
                </Button>
              ) : (
                <span className={recordTab.rule}>{held}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <LiveMessage>{composites.message}</LiveMessage>
      <AskedDialog
        asked={composites.asking}
        confirmLabel="Take it out"
        onConfirm={composites.confirm}
        onCancel={composites.cancel}
      />
    </Panel>
  );
}

function Add({ role, composites }: { role: Role; composites: RoleComposites }) {
  const s = composites.add;
  return (
    <SaveSection
      title="Add a composite"
      saveLabel={`Nest it in ${role.name}`}
      description={`Nests one more role in ${role.name}; whoever holds ${role.name} holds it from their next token.`}
      save={s}
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
        <p className={recordTab.rule}>Checking what you may nest here…</p>
      )}
    </SaveSection>
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
  ceiling: RoleCeiling;
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
  ceiling: RoleCeiling;
}) {
  const read = useCompositesRead(tenant, role.id);
  return (
    <ReadGate
      read={read}
      label="Loading the composites"
      fields={2}
      failed="The composites could not be loaded"
    >
      {(data, etag) => (
        <div className={recordTab.tab}>
          <Ready
            tenant={tenant}
            role={role}
            ceiling={ceiling}
            data={data}
            etag={etag}
            gone={read.gone}
          />
        </div>
      )}
    </ReadGate>
  );
}
