import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isRefused } from '#/shared/service/failure.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

// `refused` is a 403: the read needs a capability the caller lacks.
export type Read<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; refused: boolean; retry: () => void };

// One read a tab shows, keyed so a change elsewhere can ask for it again.
export function useRead<T>(
  key: readonly unknown[],
  asked: boolean,
  read: () => Promise<GatewayResult<T>>,
): Read<T> {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: read, enabled: asked });
  const result = query.data;
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return {
    status: 'failed',
    refused: isRefused(result),
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
}
