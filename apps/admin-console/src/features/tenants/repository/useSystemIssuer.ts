import { useQuery } from '@tanstack/react-query';
import { readSystemIssuer } from '#/features/tenants/adapter/tenants.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// The system tenant's issuer as relying parties see it, the public base's.
export function useSystemIssuer(): string | undefined {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: ['tenants', 'system-issuer'],
    queryFn: () => readSystemIssuer(gateway),
    staleTime: Infinity,
  });
  const result = query.data;
  return result?.ok === true ? result.data : undefined;
}
