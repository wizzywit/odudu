import {
  countResponseSchema,
  listCredentialsResponseSchema,
  listSubjectsResponseSchema,
  lockoutSchema,
  profileSchema,
  subjectSchema,
  usernamePolicySchema,
  type AmendProfileRequest,
  type AmendSubjectRequest,
  type CountResponse,
  type ListCredentialsResponse,
  type ListSubjectsResponse,
  type Lockout,
  type Profile,
  type Subject,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

const nothing = z.undefined();

function path(tenant: string): string {
  return encodeURIComponent(tenant);
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

export function readSubjectPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListSubjectsResponse>> {
  const t = path(tenant);
  return gateway.request('GET', `admin/tenants/${t}/subjects?${query.toString()}`, {
    schema: listSubjectsResponseSchema,
  });
}

export function readSubjectCount(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  const t = path(tenant);
  return gateway.request('GET', `admin/tenants/${t}/subjects/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

export function createSubject(
  gateway: Gateway,
  tenant: string,
  input: { username: string; email: string },
): Promise<GatewayResult<Subject>> {
  const t = path(tenant);
  return gateway.request('POST', `admin/tenants/${t}/subjects`, {
    body: { username: input.username, ...(input.email === '' ? {} : { email: input.email }) },
    schema: subjectSchema,
  });
}

export function readSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Subject>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}`, { schema: subjectSchema });
}

export function amendSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  changes: AmendSubjectRequest,
  ifMatch: string,
): Promise<GatewayResult<Subject>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('PATCH', `admin/tenants/${t}/subjects/${id}`, {
    body: changes,
    ifMatch,
    schema: subjectSchema,
  });
}

export function deleteSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}`, { schema: nothing });
}

export function readProfile(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Profile>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/profile`, {
    schema: profileSchema,
  });
}

export function amendProfile(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  changes: AmendProfileRequest,
  ifMatch: string,
): Promise<GatewayResult<Profile>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('PATCH', `admin/tenants/${t}/subjects/${id}/profile`, {
    body: changes,
    ifMatch,
    schema: profileSchema,
  });
}

export function readCredentials(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<ListCredentialsResponse>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/credentials`, {
    schema: listCredentialsResponseSchema,
  });
}

export function deleteCredential(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  credentialId: string,
): Promise<GatewayResult<undefined>> {
  const t = path(tenant);
  const id = segment(subjectId);
  const credential = segment(credentialId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/credentials/${credential}`, {
    schema: nothing,
  });
}

export function revokeRecoveryCodes(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/recovery-codes`, {
    schema: nothing,
  });
}

export function readLockout(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Lockout>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/lockout`, {
    schema: lockoutSchema,
  });
}

export function clearLockout(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  const t = path(tenant);
  const id = segment(subjectId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/lockout`, {
    schema: nothing,
  });
}

export async function readUsernameEditable(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<boolean>> {
  const t = path(tenant);
  const result = await gateway.request('GET', `admin/tenants/${t}/subjects/username-policy`, {
    schema: usernamePolicySchema,
  });
  return result.ok ? { ...result, data: result.data.username_editable } : result;
}
