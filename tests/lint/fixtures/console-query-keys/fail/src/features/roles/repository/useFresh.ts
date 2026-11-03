import { useMutation } from '@tanstack/react-query';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';

export function useFresh(tenant: string) {
  const fresh = useFreshRead();
  const { invalidate, invalidateExact } = useInvalidate();
  fresh.read(['find', tenant], () => null);
  invalidate(['list', tenant]);
  invalidateExact(['other']);
  return useMutation({ mutationKey: ['mutate'], mutationFn: () => null });
}
