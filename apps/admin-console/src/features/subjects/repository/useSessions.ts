import type { Consent, EndSessionsResponse, Grant, Session } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endAllSessions,
  endSession,
  readConsents,
  readGrants,
  readSessions,
  revokeConsent,
  revokeGrants,
} from '#/features/subjects/adapter/sessions.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

function sessionsResource(id: string): string {
  return `subjects/${id}/sessions`;
}

function consentsResource(id: string): string {
  return `subjects/${id}/consents`;
}

function grantsResource(id: string): string {
  return `subjects/${id}/grants`;
}

export function useSessionList(tenant: string, id: string): ResourceListState<Session> {
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

export interface Change<A, R> {
  busy: boolean;
  run: (arg: A) => Promise<GatewayResult<R>>;
}

// A write that ends sessions or revokes grants changes what all three lists
// show: a session's grants go with it, and a consent's grants with it.
function useSubjectChange<A, R>(
  tenant: string,
  id: string,
  write: (gateway: Gateway, arg: A) => Promise<GatewayResult<R>>,
): Change<A, R> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (arg: A) => write(gateway, arg),
    onSettled: () => {
      for (const key of [
        ['list', tenant, sessionsResource(id)],
        ['list', tenant, grantsResource(id)],
        ['list', tenant, consentsResource(id)],
      ]) {
        client.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
    },
  });
  return { busy: mutation.isPending, run: (arg) => mutation.mutateAsync(arg) };
}

export function useEndSession(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, session: Session) =>
    endSession(gateway, tenant, id, session.id),
  );
}

export function useEndAllSessions(tenant: string, id: string) {
  return useSubjectChange<'all', EndSessionsResponse>(tenant, id, (gateway) =>
    endAllSessions(gateway, tenant, id),
  );
}

export function useRevokeConsent(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, consent: Consent) =>
    revokeConsent(gateway, tenant, id, consent.client_id),
  );
}

export function useRevokeGrants(tenant: string, id: string) {
  return useSubjectChange(tenant, id, (gateway, client: { id: string; key: string }) =>
    revokeGrants(gateway, tenant, id, client.id),
  );
}
