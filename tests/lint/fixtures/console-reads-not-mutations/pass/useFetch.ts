import { useQueryClient } from '@tanstack/react-query';
import { findTenant } from '#/features/tenants/adapter/tenants.ts';

export function useFetch(gateway: unknown) {
  const client = useQueryClient();
  return (name: string) =>
    client.query({
      queryKey: ['find', name],
      queryFn: () => findTenant(gateway, name),
      staleTime: 0,
    });
}
