import { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';

export const TENANT_ADMIN = 'tenant-admin';
export const MANAGE_TENANTS = 'manage-tenants';

// What the last-administrator guard counts: system's administrators are
// those who can reach every tenant, which is manage-tenants.
export function administratorCapability(tenant: string): 'tenant-admin' | 'manage-tenants' {
  return tenant === SYSTEM_TENANT ? MANAGE_TENANTS : TENANT_ADMIN;
}

// tenant-admin nests every capability role, and in system manage-tenants too.
export function tenantAdminCarries(tenant: string): readonly AdminCapability[] {
  return tenant === SYSTEM_TENANT
    ? ADMIN_CAPABILITIES
    : ADMIN_CAPABILITIES.filter((capability) => capability !== MANAGE_TENANTS);
}

export type AdministratorCall = 'create' | 'grant' | 'password';

// Each call is one step a reload can land between. The one-time password is
// issued last: a lost answer is replaced by issuing another, which nothing
// else here can say of itself.
export function administratorCalls(done: {
  readonly subjectId: string | null;
  readonly granted: boolean;
}): readonly AdministratorCall[] {
  const calls: AdministratorCall[] = [];
  if (done.subjectId === null) calls.push('create');
  if (!done.granted) calls.push('grant');
  calls.push('password');
  return calls;
}

// A tenant may make a client role of its own named `tenant-admin`, so the
// one that grants the console is found through the built-in client.
export function builtinAdminClient(
  clients: readonly { readonly id: string; readonly builtin_admin: boolean }[],
): string | null {
  return clients.find((client) => client.builtin_admin)?.id ?? null;
}

interface ClientRole {
  readonly id: string;
  readonly name: string;
  readonly client_id: string | null;
}

export function tenantAdminRole(roles: readonly ClientRole[], adminClient: string): string | null {
  return (
    roles.find((role) => role.name === TENANT_ADMIN && role.client_id === adminClient)?.id ?? null
  );
}

export function administratorRoleNames(tenant: string): readonly string[] {
  return [...new Set([TENANT_ADMIN, administratorCapability(tenant)])];
}

// Every role of the built-in client whose holder the guard counts.
export function administratorRoleIds(
  tenant: string,
  roles: readonly ClientRole[],
  adminClient: string,
): readonly string[] {
  const names = new Set(administratorRoleNames(tenant));
  return roles
    .filter((role) => role.client_id === adminClient && names.has(role.name))
    .map((role) => role.id);
}

// A subject holding the capability only through a group or a nested role
// holds none of these itself, so removing its own roles would change nothing.
export function holdsDirectly(held: readonly string[], granting: readonly string[]): boolean {
  return held.some((role) => granting.includes(role));
}

export function withRole(held: readonly string[], role: string): readonly string[] {
  return held.includes(role) ? held : [...held, role];
}

export function withoutRoles(
  held: readonly string[],
  removed: readonly string[],
): readonly string[] {
  return held.filter((role) => !removed.includes(role));
}

// Each request adding or removing an administrator makes, by what its route
// needs (ADMIN_ROUTES in @odudu/protocol-admin). A cross-tenant caller's
// capabilities are its own tenant's, so `system`'s whoami answers for them.
export type AdministratorRequest =
  | 'create'
  | 'clients'
  | 'roles'
  | 'subject-roles'
  | 'set-roles'
  | 'password'
  // Looking for a subject whose creation's answer was lost.
  | 'find';

// The roles list admits manage-tenant too; view-users is the lesser.
export const ADMINISTRATOR_REQUEST_NEEDS: Readonly<Record<AdministratorRequest, AdminCapability>> =
  {
    create: 'manage-users',
    clients: 'manage-clients',
    roles: 'view-users',
    'subject-roles': 'view-users',
    'set-roles': 'manage-users',
    password: 'manage-users',
    find: 'view-users',
  };

export const GRANT_REQUESTS: readonly AdministratorRequest[] = [
  'clients',
  'roles',
  'subject-roles',
  'set-roles',
];

const CALL_REQUESTS: Readonly<Record<AdministratorCall, readonly AdministratorRequest[]>> = {
  create: ['create'],
  grant: GRANT_REQUESTS,
  password: ['password'],
};

// Giving or taking tenant-admin is held to the caller's own capabilities
// (ADR 0040), so it needs every one the role carries.
export function roleChangeNeeds(tenant: string): readonly AdminCapability[] {
  return [
    ...new Set([
      ...GRANT_REQUESTS.map((request) => ADMINISTRATOR_REQUEST_NEEDS[request]),
      ...tenantAdminCarries(tenant),
    ]),
  ];
}

// What the calls still to make need, so a resumed step asks for no more.
// The grant and the password each need all that tenant-admin carries: one
// hands the role out, the other writes to a subject who holds it (ADR 0040).
export function administratorNeeds(
  tenant: string,
  done: { readonly subjectId: string | null; readonly granted: boolean },
): readonly AdminCapability[] {
  const calls = administratorCalls(done);
  const requests = calls.flatMap((call) => CALL_REQUESTS[call]);
  return [
    ...new Set([
      ...requests.map((request) => ADMINISTRATOR_REQUEST_NEEDS[request]),
      ...tenantAdminCarries(tenant),
    ]),
  ];
}
