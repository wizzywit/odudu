import { useMutation } from '@tanstack/react-query';
import { findTenant } from '#/features/tenants/adapter/tenants.ts';

export function useFind(gateway: unknown) {
  return useMutation({ mutationFn: (name: string) => findTenant(gateway, name) });
}
