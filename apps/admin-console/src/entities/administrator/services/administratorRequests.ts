import { type AdminCapability } from '#/shared/services/principal';
import { TENANT_ADMIN, tenantAdminCarries } from '#/shared/services/capabilities';
import type {
  AdministratorCall,
  AdministratorRequest,
} from '#/entities/administrator/types/administrator';

// The request a refused call is reported against, when it ran with no subject.
export function subjectlessRequest(call: 'grant' | 'password'): AdministratorRequest {
  return call === 'grant' ? 'set-roles' : 'password';
}

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
