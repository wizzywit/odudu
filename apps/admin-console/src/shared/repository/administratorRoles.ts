import {
  readAdminClients,
  readAdministratorPage,
  readClientRoles,
  readSubjectRoles,
  setSubjectRoles,
} from '#/shared/adapter/administrators.ts';
import {
  administratorCapability,
  administratorRoleIds,
  administratorRoleNames,
  builtinAdminClient,
  holdsDirectly,
  TENANT_ADMIN,
  clientRole,
  withoutRoles,
  withRole,
  type AdministratorRequest,
} from '#/shared/service/administrators.ts';
import type { Gateway, GatewayFailure } from '#/shared/transport/gateway.ts';

export function defect(message: string): GatewayFailure {
  console.error(message);
  return { ok: false, kind: 'defect' };
}

export interface Refused {
  failure: GatewayFailure;
  request: AdministratorRequest;
}

export function refusedAt(failure: GatewayFailure, request: AdministratorRequest): Refused {
  return { failure, request };
}

async function adminClientOf(
  gateway: Gateway,
  tenant: string,
): Promise<{ client: string } | Refused> {
  const clients = await readAdminClients(gateway, tenant);
  if (!clients.ok) return refusedAt(clients, 'clients');
  const client = builtinAdminClient(clients.data.items);
  if (client === null) {
    return refusedAt(
      defect(`console defect: ${tenant} lists no built-in odudu-admin client`),
      'clients',
    );
  }
  return { client };
}

async function heldRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<{ ids: readonly string[]; etag: string } | Refused> {
  const held = await readSubjectRoles(gateway, tenant, subjectId);
  if (!held.ok) return refusedAt(held, 'subject-roles');
  if (held.etag === null) {
    return refusedAt(
      defect(`console defect: ${tenant} answered a subject's roles without an ETag`),
      'subject-roles',
    );
  }
  return { ids: held.data.items.map((assigned) => assigned.id), etag: held.etag };
}

function isRefused(value: object): value is Refused {
  return 'failure' in value;
}

// Each holding is looked for by its own name, since a client's roles can run
// past one page; what the subject already holds is kept.
export async function grantHoldings(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  holdings: readonly string[],
): Promise<Refused | null> {
  const client = await adminClientOf(gateway, tenant);
  if (isRefused(client)) return client;
  const ids: string[] = [];
  for (const name of holdings) {
    const roles = await readClientRoles(gateway, tenant, client.client, name);
    if (!roles.ok) return refusedAt(roles, 'roles');
    const role = clientRole(roles.data.items, client.client, name);
    if (role === null) {
      return refusedAt(defect(`console defect: ${tenant}'s odudu-admin has no ${name}`), 'roles');
    }
    ids.push(role);
  }
  const held = await heldRoles(gateway, tenant, subjectId);
  if (isRefused(held)) return held;
  const set = await setSubjectRoles(
    gateway,
    tenant,
    subjectId,
    ids.reduce<readonly string[]>((all, id) => withRole(all, id), held.ids),
    held.etag,
  );
  return set.ok ? null : refusedAt(set, 'set-roles');
}

export function grantTenantAdmin(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<Refused | null> {
  return grantHoldings(gateway, tenant, subjectId, [TENANT_ADMIN]);
}

export type Revoked =
  // stillHolds is null when it could not be checked: the subject has no
  // username to look it up by, or the look-up failed.
  | { kind: 'revoked'; stillHolds: boolean | null }
  // Held only through a group or a role that nests it, which no edit here reaches.
  | { kind: 'not-direct' }
  | ({ kind: 'refused' } & Refused);

// Only a subject's own role assignments are changed. Whether the capability
// survived through another path is asked of the server rather than worked out.
export async function revokeAdministrator(
  gateway: Gateway,
  tenant: string,
  subject: { id: string; username: string | null },
): Promise<Revoked> {
  const client = await adminClientOf(gateway, tenant);
  if (isRefused(client)) return { kind: 'refused', ...client };
  // By name, as the grant does: a client's roles can run past one page.
  const found: { id: string; name: string; client_id: string | null }[] = [];
  for (const name of administratorRoleNames(tenant)) {
    const roles = await readClientRoles(gateway, tenant, client.client, name);
    if (!roles.ok) return { kind: 'refused', ...refusedAt(roles, 'roles') };
    found.push(...roles.data.items);
  }
  const granting = administratorRoleIds(tenant, found, client.client);
  const held = await heldRoles(gateway, tenant, subject.id);
  if (isRefused(held)) return { kind: 'refused', ...held };
  if (!holdsDirectly(held.ids, granting)) return { kind: 'not-direct' };
  const set = await setSubjectRoles(
    gateway,
    tenant,
    subject.id,
    withoutRoles(held.ids, granting),
    held.etag,
  );
  if (!set.ok) return { kind: 'refused', ...refusedAt(set, 'set-roles') };
  if (subject.username === null) return { kind: 'revoked', stillHolds: null };
  const holders = await readAdministratorPage(
    gateway,
    tenant,
    new URLSearchParams({
      capability: administratorCapability(tenant),
      username: subject.username,
    }),
  );
  return {
    kind: 'revoked',
    stillHolds: holders.ok ? holders.data.items.some((holder) => holder.id === subject.id) : null,
  };
}
