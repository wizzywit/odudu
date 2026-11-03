import { useRead } from '#/shared/lib/repository/useRead';

export function useReads(tenant: string) {
  return useRead(['record', tenant, 'x']);
}
