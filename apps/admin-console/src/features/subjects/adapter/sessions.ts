import {
  endSessionsResponseSchema,
  listConsentsResponseSchema,
  listGrantsResponseSchema,
  listSessionsResponseSchema,
  revokeGrantsResponseSchema,
  type Consent as WireConsent,
  type Grant as WireGrant,
  type Session as WireSession,
} from '@odudu/contracts/admin';
import type { ListPage } from '#/shared/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, mapResult, nothing } from '#/shared/adapter/route';
import type { Consent } from '#/features/subjects/types/consent';
import type { Grant, GrantsRevoked } from '#/features/subjects/types/grant';
import type { SessionsEnded, SubjectSession } from '#/features/subjects/types/subjectSession';

function sessionOf(wire: WireSession): SubjectSession {
  return {
    id: wire.id,
    createdAt: wire.created_at,
    lastActiveAt: wire.last_active_at,
    remembered: wire.remembered,
    clientIds: wire.client_ids,
  };
}

function consentOf(wire: WireConsent): Consent {
  return {
    clientId: wire.client_id,
    clientKey: wire.client_key,
    scopeNames: wire.scope_names,
    grantedAt: wire.granted_at,
  };
}

function grantOf(wire: WireGrant): Grant {
  return {
    id: wire.id,
    clientId: wire.client_id,
    clientKey: wire.client_key,
    scope: wire.scope,
    createdAt: wire.created_at,
    sessionId: wire.session_id,
    offline: wire.offline,
    refreshExpiresAt: wire.refresh_expires_at,
  };
}

function pageOf<W, T>(
  map: (wire: W) => T,
): (page: { items: W[]; next?: string | undefined }) => ListPage<T> {
  return ({ items, next }) => ({ items: items.map(map), next });
}

export async function readSessions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<SubjectSession>>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'sessions'], {
    query,
    schema: listSessionsResponseSchema,
  });
  return mapResult(result, pageOf(sessionOf));
}

export function endSession(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  sessionId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'sessions', sessionId], {
    schema: nothing,
  });
}

export function endAllSessions(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<SessionsEnded>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'sessions'], {
    schema: endSessionsResponseSchema,
  });
}

export async function readConsents(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<Consent>>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'consents'], {
    query,
    schema: listConsentsResponseSchema,
  });
  return mapResult(result, pageOf(consentOf));
}

export function revokeConsent(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  clientId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'consents', clientId], {
    schema: nothing,
  });
}

export async function readGrants(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<Grant>>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'grants'], {
    query,
    schema: listGrantsResponseSchema,
  });
  return mapResult(result, pageOf(grantOf));
}

export function revokeGrants(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  clientId: string,
): Promise<GatewayResult<GrantsRevoked>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'grants', clientId], {
    schema: revokeGrantsResponseSchema,
  });
}
