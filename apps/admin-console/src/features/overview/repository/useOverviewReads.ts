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

function useTenantRead<T>(
  tenant: string,
  name: string,
  asked: boolean,
  read: (gateway: Gateway) => Promise<GatewayResult<T>>,
): Read<T> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = ['overview', tenant, name] as const;
  const query = useQuery({ queryKey: key, queryFn: () => read(gateway), enabled: asked });
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

export function useOverviewReads(tenant: string, asks: OverviewAsks): OverviewReads {
  const count = (collection: Collection) => (gateway: Gateway) =>
    readCount(gateway, tenant, collection);
  return {
    discovery: useTenantRead(tenant, 'discovery', asks.discovery, (g) => readDiscovery(g, tenant)),
    jwks: useTenantRead(tenant, 'jwks', asks.discovery, (g) => readJwks(g, tenant)),
    counts: {
      subjects: useTenantRead(tenant, 'subjects/count', asks.subjects, count('subjects')),
      clients: useTenantRead(tenant, 'clients/count', asks.clients, count('clients')),
      groups: useTenantRead(tenant, 'groups/count', asks.groups, count('groups')),
      roles: useTenantRead(tenant, 'roles/count', asks.roles, count('roles')),
      scopes: useTenantRead(tenant, 'scopes/count', asks.scopes, count('scopes')),
    },
    settings: useTenantRead(tenant, 'settings', asks.settings, (g) => readSettings(g, tenant)),
    smtp: useTenantRead(tenant, 'smtp', asks.smtp, (g) => readSmtp(g, tenant)),
    keys: useTenantRead(tenant, 'keys', asks.keys, (g) => readKeys(g, tenant)),
    audit: useTenantRead(tenant, 'audit/latest', asks.audit, (g) => readLatestAudit(g, tenant)),
  };
}
