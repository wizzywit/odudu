import { useMutation } from '@tanstack/react-query';
import { findTenant } from '#/pages/tenants/adapter/tenants';

export function useFind(gateway: unknown) {
  return useMutation({ mutationFn: (name: string) => findTenant(gateway, name) });
}
