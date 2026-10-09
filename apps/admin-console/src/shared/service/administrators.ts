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
  subjectId: string | null;
  granted: boolean;
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
  clients: readonly { id: string; builtin_admin: boolean }[],
): string | null {
  return clients.find((client) => client.builtin_admin)?.id ?? null;
}

interface ClientRole {
  id: string;
  name: string;
  client_id: string | null;
}

export function clientRole(
  roles: readonly ClientRole[],
  adminClient: string,
  name: string,
): string | null {
  return roles.find((role) => role.name === name && role.client_id === adminClient)?.id ?? null;
}

export function tenantAdminRole(roles: readonly ClientRole[], adminClient: string): string | null {
  return clientRole(roles, adminClient, TENANT_ADMIN);
}

export function withRole(held: readonly string[], role: string): readonly string[] {
  return held.includes(role) ? held : [...held, role];
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

export const GRANT_NEEDS: readonly AdminCapability[] = [
  ...new Set(GRANT_REQUESTS.map((request) => ADMINISTRATOR_REQUEST_NEEDS[request])),
];

export const HOLDINGS_REQUIRED = 'Choose Full, or at least one capability.';

export function holdingsProblem(holdings: readonly string[]): string | null {
  return holdings.length === 0 ? HOLDINGS_REQUIRED : null;
}

const CALL_REQUESTS: Readonly<Record<AdministratorCall, readonly AdministratorRequest[]>> = {
  create: ['create'],
  grant: GRANT_REQUESTS,
  password: ['password'],
};

// What the calls still to make need, so a resumed step asks for no more.
// The grant and the password each need all that is being given: one hands
// it out, the other writes to a subject who holds it (ADR 0040).
export function administratorNeeds(
  tenant: string,
  done: { subjectId: string | null; granted: boolean; holdings?: readonly string[] },
): readonly AdminCapability[] {
  const calls = administratorCalls(done);
  const requests = calls.flatMap((call) => CALL_REQUESTS[call]);
  const holdings = done.holdings ?? [TENANT_ADMIN];
  const given = holdings.includes(TENANT_ADMIN)
    ? tenantAdminCarries(tenant)
    : tenantAdminCarries(tenant).filter((capability) => holdings.includes(capability));
  return [
    ...new Set([...requests.map((request) => ADMINISTRATOR_REQUEST_NEEDS[request]), ...given]),
  ];
}
