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
} from '#/features/overview/service.ts';
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

export function useOverviewReads(
  tenant: string,
  asks: OverviewAsks,
  onAnswer: OnAnswer = () => undefined,
): OverviewReads {
  const count = (collection: Collection) => (gateway: Gateway) =>
    readCount(gateway, tenant, collection);
  const useRead = <T>(
    name: ReadName,
    asked: boolean,
    read: (gateway: Gateway) => Promise<GatewayResult<T>>,
  ) => useTenantRead(tenant, name, asked, read, onAnswer);
  return {
    discovery: useRead('discovery', asks.discovery, (g) => readDiscovery(g, tenant)),
    jwks: useRead('jwks', asks.discovery, (g) => readJwks(g, tenant)),
    counts: {
      subjects: useRead('subjects', asks.subjects, count('subjects')),
      clients: useRead('clients', asks.clients, count('clients')),
      groups: useRead('groups', asks.groups, count('groups')),
      roles: useRead('roles', asks.roles, count('roles')),
      scopes: useRead('scopes', asks.scopes, count('scopes')),
    },
    settings: useRead('settings', asks.settings, (g) => readSettings(g, tenant)),
    smtp: useRead('smtp', asks.smtp, (g) => readSmtp(g, tenant)),
    keys: useRead('keys', asks.keys, (g) => readKeys(g, tenant)),
    audit: useRead('audit', asks.audit, (g) => readLatestAudit(g, tenant)),
  };
}
