import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { recordKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { freshness } from '#/shared/service/read';
import { ReadFailure, readFailureOf } from '#/shared/service/readFailure';
import {
  entryEtag,
  recordView,
  seenAfter,
  shownFailure,
  type RecordView,
} from '#/shared/service/record';
import type {
  Gateway,
  GatewayFailure,
  GatewayResult,
  GatewaySuccess,
} from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

// `by` tells a read apart from what a section's save wrote in its place, so
// that only somebody else's change counts as an update.
export interface RecordEntry<R> {
  result: GatewaySuccess<R>;
  by: 'read' | 'save';
}

export interface RecordState<R> extends RecordView {
  data: R | undefined;
  etag: string | null;
  failure: GatewayFailure | null;
}

// One ETag-bearing resource, read once for every section that edits it: a
// section's save writes its answer here, so the others rebase on it.
export function useRecord<R>({
  tenant,
  record,
  read,
  enabled = true,
  recent = false,
}: {
  tenant: string;
  // The record's path within the tenant, e.g. `clients/<id>`.
  record: string;
  read: (gateway: Gateway) => Promise<GatewayResult<R>>;
  // False holds the read back, as for a record only a dialog needs.
  enabled?: boolean;
  // Kept for a moment once read, for a page that starts the read early.
  recent?: boolean;
}): RecordState<R> {
  const { gateway } = useTransport();
  const { invalidateExact } = useInvalidate();
  const key = recordKey(tenant, record);
  const query = useQuery({
    queryKey: key,
    enabled,
    ...freshness(false, recent),
    queryFn: async (): Promise<RecordEntry<R>> => {
      const result = await read(gateway);
      if (!result.ok) throw new ReadFailure(result);
      return { result, by: 'read' };
    },
  });
  const entry = query.data;
  const etag = entryEtag(entry);
  const [seen, setSeen] = useState<string | null>(null);
  const next = seenAfter(seen, etag, entry?.by);
  if (next !== seen) setSeen(next);
  const failure = readFailureOf(query.error);
  return {
    ...recordView(entry, shownFailure(query.isError, failure), seen),
    data: entry?.result.data,
    etag,
    failure,
    acknowledge: () => {
      setSeen(etag);
    },
    retry: () => {
      invalidateExact(key);
    },
  };
}
