import {
  issuePasswordResponseSchema,
  listClientsResponseSchema,
  listSubjectsResponseSchema,
  setRolesResponseSchema,
  subjectSchema,
  type IssuePasswordResponse,
  type ListClientsResponse,
  type ListRolesResponse,
  type ListSubjectsResponse,
  type SetRolesResponse,
  type Subject,
} from '@odudu/contracts/admin';
import { readRolePage } from '#/shared/adapter/directory.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

function tenantPath(tenant: string): string {
  return encodeURIComponent(tenant);
}

export function readAdministratorPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListSubjectsResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${tenantPath(tenant)}/subjects?${query.toString()}`,
    {
      schema: listSubjectsResponseSchema,
    },
  );
}

export function createSubject(
  gateway: Gateway,
  tenant: string,
  input: { readonly username: string; readonly email: string },
): Promise<GatewayResult<Subject>> {
  return gateway.request('POST', `admin/tenants/${tenantPath(tenant)}/subjects`, {
    body: { username: input.username, ...(input.email === '' ? {} : { email: input.email }) },
    schema: subjectSchema,
  });
}

// `username` is a prefix search, sorted by username: the exact one comes first.
export async function findSubject(
  gateway: Gateway,
  tenant: string,
  username: string,
): Promise<GatewayResult<Subject | null>> {
  const result = await readAdministratorPage(gateway, tenant, new URLSearchParams({ username }));
  if (!result.ok) return result;
  return {
    ...result,
    data: result.data.items.find((subject) => subject.username === username) ?? null,
  };
}

export function issuePassword(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<IssuePasswordResponse>> {
  return gateway.request(
    'POST',
    `admin/tenants/${tenantPath(tenant)}/subjects/${encodeURIComponent(subjectId)}/password`,
    { schema: issuePasswordResponseSchema },
  );
}

// A client_id search is a prefix, so a tenant's own `odudu-admin-x` comes
// back too; the caller keeps the built-in one.
export function readAdminClients(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListClientsResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${tenantPath(tenant)}/clients?client_id=odudu-admin`,
    {
      schema: listClientsResponseSchema,
    },
  );
}

export function readClientRoles(
  gateway: Gateway,
  tenant: string,
  clientId: string,
  name: string,
): Promise<GatewayResult<ListRolesResponse>> {
  return readRolePage(gateway, tenant, new URLSearchParams({ client: clientId, name }));
}

export function readSubjectRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SetRolesResponse>> {
  return gateway.request(
    'GET',
    `admin/tenants/${tenantPath(tenant)}/subjects/${encodeURIComponent(subjectId)}/roles`,
    { schema: setRolesResponseSchema },
  );
}

export function setSubjectRoles(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  roleIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<SetRolesResponse>> {
  return gateway.request(
    'PUT',
    `admin/tenants/${tenantPath(tenant)}/subjects/${encodeURIComponent(subjectId)}/roles`,
    { body: { role_ids: roleIds }, ifMatch, schema: setRolesResponseSchema },
  );
}
