import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  readCount,
  readDiscovery,
  readJwks,
  readKeys,
  readLatestAudit,
  readSettings,
  readSmtp,
} from '#/features/overview/adapter.ts';
import {
  readOutcome,
  type Collection,
  type OverviewAsks,
  type OverviewReads,
  type Read,
  type ReadName,
} from '#/features/overview/service';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Told of every answer as it arrives, so a refusal can be reported once per
// answer rather than once per render.
export type OnAnswer = (name: ReadName, result: GatewayResult<unknown>) => void;

function useTenantRead<T>(
  tenant: string,
  name: ReadName,
  asked: boolean,
  read: (gateway: Gateway) => Promise<GatewayResult<T>>,
  onAnswer: OnAnswer,
): Read<T> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['overview', tenant, name] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await read(gateway);
      onAnswer(name, result);
      return result;
    },
    enabled: asked,
  });
  return readOutcome(asked, query.data, () => {
    client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
  });
}

function ignoreAnswer(): void {
  // Nobody listening.
}

export function useOverviewReads(
  tenant: string,
  asks: OverviewAsks,
  onAnswer: OnAnswer = ignoreAnswer,
): OverviewReads {
  const count = (collection: Collection) => (gateway: Gateway) =>
    readCount(gateway, tenant, collection);
  return {
    discovery: useTenantRead(
      tenant,
      'discovery',
      asks.discovery,
      (g) => readDiscovery(g, tenant),
      onAnswer,
    ),
    jwks: useTenantRead(tenant, 'jwks', asks.discovery, (g) => readJwks(g, tenant), onAnswer),
    counts: {
      subjects: useTenantRead(tenant, 'subjects', asks.subjects, count('subjects'), onAnswer),
      clients: useTenantRead(tenant, 'clients', asks.clients, count('clients'), onAnswer),
      groups: useTenantRead(tenant, 'groups', asks.groups, count('groups'), onAnswer),
      roles: useTenantRead(tenant, 'roles', asks.roles, count('roles'), onAnswer),
      scopes: useTenantRead(tenant, 'scopes', asks.scopes, count('scopes'), onAnswer),
    },
    settings: useTenantRead(
      tenant,
      'settings',
      asks.settings,
      (g) => readSettings(g, tenant),
      onAnswer,
    ),
    smtp: useTenantRead(tenant, 'smtp', asks.smtp, (g) => readSmtp(g, tenant), onAnswer),
    keys: useTenantRead(tenant, 'keys', asks.keys, (g) => readKeys(g, tenant), onAnswer),
    audit: useTenantRead(tenant, 'audit', asks.audit, (g) => readLatestAudit(g, tenant), onAnswer),
  };
}
