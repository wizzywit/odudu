import { useQuery } from '@tanstack/react-query';
import { listKey, recordKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';

export function useResolved(tenant: string, id: string, given: readonly unknown[]) {
  const { invalidate } = useInvalidate();
  const key = recordKey(tenant, id);
  const spread = [...listKey(tenant), 'x'] as const;
  useQuery({ queryKey: key, queryFn: () => null });
  useQuery({ queryKey: given, queryFn: () => null });
  useQuery({ queryKey: spread, queryFn: () => null });
  useQuery({ queryKey: [...listKey(tenant), id] as const, queryFn: () => null });
  invalidate(key);
  invalidate(given);
}
