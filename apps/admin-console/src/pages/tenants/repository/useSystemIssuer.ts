import { useQuery } from '@tanstack/react-query';
import { readSystemIssuer } from '#/pages/tenants/adapter/tenants';
import { systemIssuerKey } from '#/shared/lib/repository/queryKeys';
import { freshness } from '#/shared/lib/services/read';
import { dataOf } from '#/shared/lib/services/settled';
import { useTransport } from '#/shared/api/transport/useTransport';

// The system tenant's issuer as relying parties see it, the public base's.
export function useSystemIssuer(): string | undefined {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: systemIssuerKey(),
    queryFn: () => readSystemIssuer(gateway),
    ...freshness(true),
  });
  return dataOf(query.data);
}
