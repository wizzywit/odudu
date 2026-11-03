import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRead } from '#/shared/lib/repository/useRead';

export function useKeys(tenant: string, id: string) {
  const client = useQueryClient();
  useQuery({ queryKey: ['list', tenant, 'roles'], queryFn: () => [] });
  useQuery({ queryKey: ['evaluate', tenant] as const, queryFn: () => [] });
  client.setQueryData(['record', tenant, id], {});
  client.getQueryData(['other', tenant]);
  return useRead({ key: ['x', id], read: () => [] });
}
