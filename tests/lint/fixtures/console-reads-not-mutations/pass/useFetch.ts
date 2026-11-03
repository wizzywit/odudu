import { useQueryClient } from '@tanstack/react-query';
import { findTenant } from '#/pages/tenants/adapter/tenants';

export function useFetch(gateway: unknown) {
  const client = useQueryClient();
  return (name: string) =>
    client.query({
      queryKey: ['find', name],
      queryFn: () => findTenant(gateway, name),
      staleTime: 0,
    });
}
