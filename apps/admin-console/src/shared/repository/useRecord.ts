import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { recordView, seenAfter, type RecordView } from '#/shared/service/record.ts';
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
  const next = seenAfter(seen, etag, entry?.by);
  if (next !== seen) setSeen(next);
  const failure = query.error instanceof RecordReadFailure ? query.error.failure : null;
  return {
    ...recordView(entry, query.isError ? failure : null, seen),
    data: entry?.result.data,
    etag,
    failure,
    acknowledge: () => {
      setSeen(etag);
    },
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
}
