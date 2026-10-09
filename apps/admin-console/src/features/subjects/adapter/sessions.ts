import {
  endSessionsResponseSchema,
  listConsentsResponseSchema,
  listGrantsResponseSchema,
  listSessionsResponseSchema,
  revokeGrantsResponseSchema,
  type EndSessionsResponse,
  type ListConsentsResponse,
  type ListGrantsResponse,
  type ListSessionsResponse,
  type RevokeGrantsResponse,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

const nothing = z.undefined();

export function readSessions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListSessionsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/sessions?${query.toString()}`, {
    schema: listSessionsResponseSchema,
  });
}

export function endSession(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  sessionId: string,
): Promise<GatewayResult<undefined>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  const sid = encodeURIComponent(sessionId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/sessions/${sid}`, {
    schema: nothing,
  });
}

export function endAllSessions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<EndSessionsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/sessions`, {
    schema: endSessionsResponseSchema,
  });
}

export function readConsents(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListConsentsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/consents?${query.toString()}`, {
    schema: listConsentsResponseSchema,
  });
}

export function revokeConsent(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  clientId: string,
): Promise<GatewayResult<undefined>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  const client = encodeURIComponent(clientId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/consents/${client}`, {
    schema: nothing,
  });
}

export function readGrants(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListGrantsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('GET', `admin/tenants/${t}/subjects/${id}/grants?${query.toString()}`, {
    schema: listGrantsResponseSchema,
  });
}

export function revokeGrants(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  clientId: string,
): Promise<GatewayResult<RevokeGrantsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  const client = encodeURIComponent(clientId);
  return gateway.request('DELETE', `admin/tenants/${t}/subjects/${id}/grants/${client}`, {
    schema: revokeGrantsResponseSchema,
  });
}
