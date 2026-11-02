import type { ClientScope } from '@odudu/contracts/admin';
import {
  useScopeRoles,
  useScopeRolesRead,
  type ScopeRoles,
} from '#/features/scopes/use-cases/useScopeRoles';
import { INCLUDE_ALL_POINTER, NO_ROLES_MAPPED } from '#/features/scopes/services/roles';
import { MappedRoles } from '#/shared/ui/MappedRoles';
import { ReadGate } from '#/shared/ui/ReadGate';
import { RolePicker } from '#/shared/ui/RolePicker';
import { SaveSection } from '#/shared/ui/SaveSection';
import { recordTab } from '#/shared/ui/RecordTab';

function Roles({ name, roles }: { name: string; roles: ScopeRoles }) {
  const s = roles.save;
  return (
    <SaveSection
      title="Roles"
      description={`A token granted ${name} carries these roles' claims.`}
      save={s}
    >
      <MappedRoles name={name} mapped={roles.mapped} empty={NO_ROLES_MAPPED} />
      {roles.offered ? (
        <RolePicker
          label={`Roles ${name} carries`}
          picker={roles.picker}
          selected={s.values.role_ids}
          unavailableOf={roles.unavailableOf}
          onChange={roles.choose}
        />
      ) : (
        <p className={recordTab.rule}>Checking what you may give or take here…</p>
      )}
      <p className={recordTab.rule}>{INCLUDE_ALL_POINTER}</p>
      {roles.kept.length === 0 ? null : (
        <p className={recordTab.rule}>
          A role you could not give is one you cannot take away either, so it stays whatever else is
          saved.
        </p>
      )}
    </SaveSection>
  );
}

function Ready({
  tenant,
  scope,
  ...read
}: {
  tenant: string;
  scope: ClientScope;
  data: Parameters<typeof useScopeRoles>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const roles = useScopeRoles({ tenant, scope, ...read });
  return <Roles name={scope.name} roles={roles} />;
}

export function RolesTab({ tenant, scope }: { tenant: string; scope: ClientScope }) {
  const read = useScopeRolesRead(tenant, scope.id);
  return (
    <ReadGate
      read={read}
      label="Loading the roles"
      fields={2}
      failed="The roles could not be loaded"
    >
      {(data, etag) => (
        <div className={recordTab.tab}>
          <Ready tenant={tenant} scope={scope} data={data} etag={etag} gone={read.gone} />
        </div>
      )}
    </ReadGate>
  );
}
