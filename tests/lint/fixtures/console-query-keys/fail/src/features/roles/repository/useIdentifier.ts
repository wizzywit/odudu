import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';

function localKey(tenant: string) {
  return ['local', tenant] as const;
}

function build(tenant: string) {
  return ['built', tenant];
}

export function useIdentifier(tenant: string, id: string, shared: boolean) {
  const { invalidate } = useInvalidate();
  const client = useQueryClient();
  const held = ['brand-new', id];
  const queryKey = ['shorthand', id] as const;
  const whoami = ['whoami', tenant] as const;
  useQuery({ queryKey: held, queryFn: () => null });
  useQuery({ queryKey, queryFn: () => null });
  useQuery({ queryKey: shared ? ['a'] : ['b'], queryFn: () => null });
  useQuery({ queryKey: localKey(tenant), queryFn: () => null });
  useQuery({ queryKey: build(tenant), queryFn: () => null });
  invalidate(whoami);
  client.setQueryData(held, 1);
}
