import { useMutation } from '@tanstack/react-query';
import { listSubjects } from '#/pages/subjects/adapter/subjects';

export function useList(gateway: unknown) {
  return useMutation({
    mutationFn: async (tenant: string) => {
      const page = await listSubjects(gateway, tenant);
      return page;
    },
  });
}
