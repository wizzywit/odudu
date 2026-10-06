import type { Client, SetRolesResponse } from '@odudu/contracts/admin';
import {
  NO_ACCOUNT,
  NO_ROLES,
  assignedCount,
  roleOwnerLine,
  SERVICE_CAPABILITY,
  SERVICE_RULE,
  type Reach,
} from '#/features/clients/service';
import {
  useServiceAccess,
  useServiceRoles,
  useServiceRolesRead,
  type ServiceRoles,
} from '#/features/clients/usecase/useServiceAccount.ts';
import { SaveSection } from '#/features/clients/view/SaveSection';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { EmptyState } from '#/shared/view/EmptyState';
import { ReadOnlyFields } from '#/shared/view/Field';
import { RolePicker } from '#/shared/view/RolePicker';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/clients/view/ServiceAccountTab/ServiceAccountTab.module.css';

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
          <p className={styles.rule}>{NO_ROLES}</p>
        ) : (
          <>
            <p className={styles.rule}>{assignedCount(page.assigned.length)}</p>
            <ul aria-label={`Assigned to ${client.name}'s service account`} className={styles.list}>
              {page.assigned.map((role) => (
                <li key={role.id}>
                  <code>{role.name}</code>
                  <span className={styles.rule}>
                    {role.client === null ? ' · tenant role' : ` · ${roleOwnerLine(role.client)}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {page.kept === null ? null : <p className={styles.rule}>{page.kept}</p>}
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
      <div className={styles.actions}>
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
  if (read.status === 'loading') return <FormSkeleton label="Loading the roles" fields={3} />;
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
    <Editor
      tenant={tenant}
      client={client}
      subjectId={subjectId}
      data={read.data}
      etag={read.etag}
      gone={gone || read.gone}
      reach={reach}
    />
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
    <div className={styles.tab}>
      {access.status === 'none' ? <p className={styles.rule}>{NO_ACCOUNT}</p> : null}
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
