import type { Scope } from '#/entities/scope';
import {
  useScopeRoles,
  useScopeRolesRead,
  type ScopeRoles,
} from '#/features/scopes/use-cases/useScopeRoles';
import { RoleMapping } from '#/features/role-mapping';
import { ReadGate } from '#/shared/ui/ReadGate';
import { recordTab } from '#/shared/ui/RecordTab';

function Roles({ name, roles }: { name: string; roles: ScopeRoles }) {
  return (
    <RoleMapping
      name={name}
      description={`A token granted ${name} carries these roles' claims.`}
      empty={roles.empty}
      mapping={roles}
      save={roles.save}
    >
      <p className={recordTab.rule}>{roles.pointer}</p>
    </RoleMapping>
  );
}

function Ready({
  tenant,
  scope,
  ...read
}: {
  tenant: string;
  scope: Scope;
  data: Parameters<typeof useScopeRoles>[0]['data'];
  etag: string;
  gone: boolean;
}) {
  const roles = useScopeRoles({ tenant, scope, ...read });
  return <Roles name={scope.name} roles={roles} />;
}

export function RolesTab({ tenant, scope }: { tenant: string; scope: Scope }) {
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
