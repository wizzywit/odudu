import type { SessionsEnded, SubjectSession } from '#/features/subjects/types/subjectSession';
import {
  endAllSessions,
  endSession,
  readConsents,
  readGrants,
  readSessions,
  revokeConsent,
  revokeGrants,
} from '#/features/subjects/adapter/sessions';
import { listKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useResourceList } from '#/shared/repository/useResourceList';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { type Consent } from '#/features/subjects/types/consent';
import { type Grant } from '#/features/subjects/types/grant';

function sessionsResource(id: string): string {
  return `subjects/${id}/sessions`;
}

function consentsResource(id: string): string {
  return `subjects/${id}/consents`;
}

function grantsResource(id: string): string {
  return `subjects/${id}/grants`;
}

export function useSessionList(tenant: string, id: string): ResourceListState<SubjectSession> {
  return useResourceList({
    tenant,
    resource: sessionsResource(id),
    read: (gateway, query) => readSessions(gateway, tenant, id, query),
  });
}

export function useGrantList(tenant: string, id: string): ResourceListState<Grant> {
  return useResourceList({
    tenant,
    resource: grantsResource(id),
    read: (gateway, query) => readGrants(gateway, tenant, id, query),
  });
}

export function useConsentList(tenant: string, id: string): ResourceListState<Consent> {
  return useResourceList({
    tenant,
    resource: consentsResource(id),
    read: (gateway, query) => readConsents(gateway, tenant, id, query),
  });
}

// A write that ends sessions or revokes grants changes what all three lists
// show: a session's grants go with it, and a consent's grants with it.
function useSubjectChange<A, R>(
  tenant: string,
  id: string,
  write: (gateway: Gateway, arg: A) => Promise<GatewayResult<R>>,
): Write<A, GatewayResult<R>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: write,
    onSettled: () => {
      invalidate(
        listKey(tenant, sessionsResource(id)),
        listKey(tenant, grantsResource(id)),
        listKey(tenant, consentsResource(id)),
      );
    },
  });
}

export function useEndSession(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, session: SubjectSession) =>
    endSession(gateway, tenant, id, session.id),
  );
}

export function useEndAllSessions(tenant: string, id: string) {
  return useSubjectChange<'all', SessionsEnded>(tenant, id, (gateway) =>
    endAllSessions(gateway, tenant, id),
  );
}

export function useRevokeConsent(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, consent: Consent) =>
    revokeConsent(gateway, tenant, id, consent.clientId),
  );
}

export function useRevokeGrants(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, client: { id: string; key: string }) =>
    revokeGrants(gateway, tenant, id, client.id),
  );
}
