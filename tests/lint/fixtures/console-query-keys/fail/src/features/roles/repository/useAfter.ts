import { useQueryClient } from '@tanstack/react-query';
import { listKey } from '#/shared/lib/repository/queryKeys';

export function useAfter(tenant: string) {
  const client = useQueryClient();
  const kind = ['list', tenant];
  client.invalidateQueries({ queryKey: listKey(tenant) });
  return kind;
}
