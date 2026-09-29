import type {
  AuditEvent,
  CountResponse,
  Settings,
  SigningKey,
  SmtpConfig,
} from '@odudu/contracts/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  readCount,
  readDiscovery,
  readJwks,
  readKeys,
  readLatestAudit,
  readSettings,
  readSmtp,
  type Collection,
} from '#/features/overview/adapter.ts';
import type { Discovery, Jwks, Read } from '#/features/overview/service.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface OverviewAsks {
  readonly discovery: boolean;
  readonly subjects: boolean;
  readonly clients: boolean;
  readonly groups: boolean;
  readonly roles: boolean;
  readonly scopes: boolean;
  readonly settings: boolean;
  readonly smtp: boolean;
  readonly keys: boolean;
  readonly audit: boolean;
}

export interface OverviewReads {
  readonly discovery: Read<Discovery>;
  readonly jwks: Read<Jwks>;
  readonly counts: Readonly<Record<Collection, Read<CountResponse>>>;
  readonly settings: Read<Settings>;
  readonly smtp: Read<SmtpConfig>;
  readonly keys: Read<readonly SigningKey[]>;
  readonly audit: Read<readonly AuditEvent[]>;
}

export type ReadName = keyof OverviewAsks | 'jwks';

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
  if (!asked) return { status: 'off' };
  const result = query.data;
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return {
    status: 'failed',
    refused: result.kind === 'problem' && result.problem.status === 403,
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
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
