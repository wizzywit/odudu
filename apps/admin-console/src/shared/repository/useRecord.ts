import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RecordView } from '#/shared/service/record.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// `by` tells a read apart from what a section's save wrote in its place, so
// that only somebody else's change counts as an update.
export interface RecordEntry<R> {
  readonly result: GatewayResult<R>;
  readonly by: 'read' | 'save';
}

export function recordKey(tenant: string, record: string) {
  return ['record', tenant, record] as const;
}

export interface RecordState<R> extends RecordView {
  readonly data: R | undefined;
  readonly etag: string | null;
  readonly failure: GatewayFailure | null;
}

// One ETag-bearing resource, read once for every section that edits it: a
// section's save writes its answer here, so the others rebase on it.
export function useRecord<R>({
  tenant,
  record,
  read,
}: {
  readonly tenant: string;
  // The record's path within the tenant, e.g. `clients/<id>`.
  readonly record: string;
  readonly read: (gateway: Gateway) => Promise<GatewayResult<R>>;
}): RecordState<R> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = recordKey(tenant, record);
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<RecordEntry<R>> => ({ result: await read(gateway), by: 'read' }),
  });
  const entry = query.data;
  const result = entry?.result;
  const etag = result?.ok === true ? result.etag : null;
  const [seen, setSeen] = useState<string | null>(null);
  if (etag !== null && etag !== seen && (seen === null || entry?.by === 'save')) setSeen(etag);
  const failure = result === undefined || result.ok ? null : result;
  const missing = failure?.kind === 'problem' && failure.problem.status === 404;
  return {
    status: result === undefined ? 'loading' : result.ok ? 'ready' : missing ? 'missing' : 'failed',
    data: result?.ok === true ? result.data : undefined,
    etag,
    failure,
    updated: etag !== null && seen !== null && etag !== seen,
    acknowledge: () => {
      setSeen(etag);
    },
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
}
