import type { GroupRecord } from '#/entities/group';
import {
  useGroupRoles,
  useGroupRolesRead,
  type GroupRoles,
} from '#/pages/groups/use-cases/useGroupRoles';
import type { GroupCeiling } from '#/pages/groups/use-cases/useGroupRecordPage';
import { AskedDialog } from '#/shared/ui/ConfirmDialog';
import { RoleMapping } from '#/features/role-mapping';
import { ReadGate } from '#/shared/ui/ReadGate';
import { recordTab } from '#/shared/ui/RecordTab';

function Roles({ path, roles }: { path: string; roles: GroupRoles }) {
  return (
    <RoleMapping
      name={path}
      description={`Every role here is held by each member of ${path} and of every group beneath it.`}
      mapping={roles}
      save={roles.save}
    >
      <AskedDialog
        asked={roles.asking}
        confirmLabel="Save Roles"
        onConfirm={roles.confirm}
        onCancel={roles.cancel}
      />
    </RoleMapping>
  );
}

function Ready({
  tenant,
  group,
  ceiling,
  ...read
}: {
  tenant: string;
  group: GroupRecord;
  ceiling: GroupCeiling;
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
  group: GroupRecord;
  ceiling: GroupCeiling;
}) {
  const read = useGroupRolesRead(tenant, group.id);
  return (
    <ReadGate
      read={read}
      label="Loading the roles"
      fields={2}
      failed="The roles could not be loaded"
    >
      {(data, etag) => (
        <div className={recordTab.tab}>
          <Ready
            tenant={tenant}
            group={group}
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
