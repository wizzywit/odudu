import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { RECORD_KIND } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import type { GatewayResult } from '#/shared/api/transport/gateway';

export interface ChangeReach {
  // Query kinds keyed by record id, read again but for a deleted record's.
  kinds: readonly string[];
  // Record entries under these prefixes are read again, but not a deleted
  // record's own, which would only find it gone.
  records: readonly string[];
  // The record path of an id, to leave a deleted record's entries alone.
  recordOf: (id: string) => string;
  keys: readonly QueryKey[];
  // Record entries under these prefixes are dropped when a record is deleted.
  dropped?: readonly string[];
}

// Once a change succeeds, whatever it can alter is read again; a refused or
// lost one leaves everything as it was.
export function useAfterChange(tenant: string, deleted: string | null, reach: ChangeReach) {
  const client = useQueryClient();
  const { invalidate } = useInvalidate();
  return <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (!result.ok) return result;
    const gone = deleted === null ? null : reach.recordOf(deleted);
    const isRecord = (kind: unknown, which: unknown, prefixes: readonly string[]): boolean =>
      kind === RECORD_KIND &&
      typeof which === 'string' &&
      prefixes.some((prefix) => which.startsWith(prefix));
    client
      .invalidateQueries({
        predicate: ({ queryKey: [kind, at, which] }) =>
          at === tenant &&
          ((typeof kind === 'string' && reach.kinds.includes(kind) && which !== deleted) ||
            (isRecord(kind, which, reach.records) &&
              (gone === null || !String(which).startsWith(gone)))),
      })
      .catch(() => undefined);
    if (deleted !== null && reach.dropped !== undefined) {
      const dropped = reach.dropped;
      client.removeQueries({
        predicate: ({ queryKey: [kind, at, which] }) =>
          at === tenant && isRecord(kind, which, dropped),
      });
    }
    invalidate(...reach.keys);
    return result;
  };
}
