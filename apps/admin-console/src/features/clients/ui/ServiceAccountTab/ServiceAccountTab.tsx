import type { Client, SetRolesResponse } from '@odudu/contracts/admin';
import { NO_ROLES, assignedCount } from '#/features/clients/services/serviceRoles';
import { SERVICE_CAPABILITY, SERVICE_RULE } from '#/features/clients/services/serviceAccess';
import { type Reach } from '#/features/clients/services/ceiling';
import { roleOwnerLine } from '#/features/clients/services/clientRoles';
import {
  useServiceAccess,
  useServiceRoles,
  useServiceRolesRead,
  type ServiceRoles,
} from '#/features/clients/use-cases/useServiceAccount';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ReadOnlyFields } from '#/shared/ui/Field';
import { RolePicker } from '#/entities/role';
import { recordTab } from '#/shared/ui/RecordTab';

function Editor({
  tenant,
  client,
  subjectId,
  data,
  etag,
  gone,
  reach,
}: {
  tenant: string;
  client: Client;
  subjectId: string;
  data: SetRolesResponse;
  etag: string;
  gone: boolean;
  reach: Reach;
}) {
  const page = useServiceRoles({ tenant, client, subjectId, data, etag, gone, reach });
  return (
    <ReadOnlyFields when={!page.offered}>
      <Roles client={client} page={page} />
    </ReadOnlyFields>
  );
}

function Roles({ client, page }: { client: Client; page: ServiceRoles }) {
  const s = page.save;
  return (
    <>
      <SaveSection title="Roles" description={SERVICE_RULE} save={s}>
        {page.assigned.length === 0 ? (
          <p className={recordTab.rule}>{NO_ROLES}</p>
        ) : (
          <>
            <p className={recordTab.rule}>{assignedCount(page.assigned.length)}</p>
            <ul
              aria-label={`Assigned to ${client.name}'s service account`}
              className={recordTab.list}
            >
              {page.assigned.map((role) => (
                <li key={role.id}>
                  <code>{role.name}</code>
                  <span className={recordTab.rule}>
                    {role.client === null ? ' · tenant role' : ` · ${roleOwnerLine(role.client)}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {page.kept === null ? null : <p className={recordTab.rule}>{page.kept}</p>}
        {page.offered ? (
          <RolePicker
            label={`Roles ${client.name}'s service account holds directly`}
            picker={page.picker}
            selected={s.values.role_ids}
            unavailableOf={page.unavailableOf}
            onChange={page.choose}
          />
        ) : null}
      </SaveSection>
      <div className={recordTab.actions}>
        <ButtonLink href={page.accountHref} size="small" variant="quiet">
          Open the service account
        </ButtonLink>
      </div>
    </>
  );
}

function Account({
  tenant,
  client,
  subjectId,
  gone,
  reach,
}: {
  tenant: string;
  client: Client;
  subjectId: string;
  gone: boolean;
  reach: Reach;
}) {
  const read = useServiceRolesRead(tenant, subjectId);
  return (
    <ReadGate
      read={read}
      label="Loading the roles"
      fields={3}
      failed="The roles could not be loaded"
    >
      {(data, etag) => (
        <Editor
          tenant={tenant}
          client={client}
          subjectId={subjectId}
          data={data}
          etag={etag}
          gone={gone || read.gone}
          reach={reach}
        />
      )}
    </ReadGate>
  );
}

export function ServiceAccountTab({
  tenant,
  client,
  gone,
  reach,
}: {
  tenant: string;
  client: Client;
  gone: boolean;
  reach: Reach;
}) {
  const access = useServiceAccess(tenant, client);
  return (
    <div className={recordTab.tab}>
      {access.idle === null ? null : <p className={recordTab.rule}>{access.idle}</p>}
      {access.status === 'none' ? <p className={recordTab.rule}>{access.note}</p> : null}
      {access.status === 'denied' ? (
        <CapabilityNote capability={SERVICE_CAPABILITY}>The service account's roles</CapabilityNote>
      ) : null}
      {access.status === 'ready' ? (
        <Account
          tenant={tenant}
          client={client}
          subjectId={access.subjectId}
          gone={gone}
          reach={reach}
        />
      ) : null}
    </div>
  );
}
