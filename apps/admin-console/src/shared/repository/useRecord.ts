import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RecordView } from '#/shared/service/record.ts';
import type {
  Gateway,
  GatewayFailure,
  GatewayResult,
  GatewaySuccess,
} from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// `by` tells a read apart from what a section's save wrote in its place, so
// that only somebody else's change counts as an update.
export interface RecordEntry<R> {
  result: GatewaySuccess<R>;
  by: 'read' | 'save';
}

export function recordKey(tenant: string, record: string) {
  return ['record', tenant, record] as const;
}

export interface RecordState<R> extends RecordView {
  data: R | undefined;
  etag: string | null;
  failure: GatewayFailure | null;
}

// Thrown so that a failed re-read leaves the record already read in place:
// the sections editing it stay mounted, and their edits with them.
class RecordReadFailure extends Error {
  readonly failure: GatewayFailure;
  constructor(failure: GatewayFailure) {
    super('a record could not be read');
    this.failure = failure;
  }
}

function isMissing(failure: GatewayFailure | null): boolean {
  return failure?.kind === 'problem' && failure.problem.status === 404;
}

// One ETag-bearing resource, read once for every section that edits it: a
// section's save writes its answer here, so the others rebase on it.
export function useRecord<R>({
  tenant,
  record,
  read,
}: {
  tenant: string;
  // The record's path within the tenant, e.g. `clients/<id>`.
  record: string;
  read: (gateway: Gateway) => Promise<GatewayResult<R>>;
}): RecordState<R> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = recordKey(tenant, record);
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<RecordEntry<R>> => {
      const result = await read(gateway);
      if (!result.ok) throw new RecordReadFailure(result);
      return { result, by: 'read' };
    },
  });
  const entry = query.data;
  const etag = entry?.result.etag ?? null;
  const [seen, setSeen] = useState<string | null>(null);
  if (etag !== null && etag !== seen && (seen === null || entry?.by === 'save')) setSeen(etag);
  const failure = query.error instanceof RecordReadFailure ? query.error.failure : null;
  const failed = query.isError && failure !== null;
  let status: RecordView['status'] = 'loading';
  if (entry !== undefined) status = 'ready';
  else if (failed) status = isMissing(failure) ? 'missing' : 'failed';
  return {
    status,
    data: entry?.result.data,
    etag,
    failure,
    updated: etag !== null && seen !== null && etag !== seen,
    refreshFailed: entry !== undefined && failed,
    gone: entry !== undefined && failed && isMissing(failure),
    acknowledge: () => {
      setSeen(etag);
    },
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
}
