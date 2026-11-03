import { useMutation } from '@tanstack/react-query';
import { createTenant } from '#/pages/tenants/adapter/tenants';
import { readFileText } from '#/pages/tenants/adapter/files';

export function useCreate(gateway: unknown) {
  return useMutation({
    mutationFn: async (input: { name: string; file: File }) =>
      createTenant(gateway, { name: input.name, text: await readFileText(input.file) }),
  });
}
