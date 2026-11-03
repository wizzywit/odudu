import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listKey, recordKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';

const ORDER = ['read', 'write'];
const LABELS = ['name', 'list'];

export function useKeys(tenant: string, id: string) {
  const client = useQueryClient();
  const key = recordKey(tenant, id);
  const invalidate = useInvalidate();
  useQuery({ queryKey: listKey(tenant, 'roles'), queryFn: () => ORDER });
  client.setQueryData(recordKey(tenant, id), LABELS);
  client.removeQueries({ queryKey: key, exact: true });
  invalidate(listKey(tenant));
  return useRead({ key, read: () => LABELS });
}
