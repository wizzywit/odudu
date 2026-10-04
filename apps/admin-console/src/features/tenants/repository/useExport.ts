import { useMutation } from '@tanstack/react-query';
import { saveFile } from '#/features/tenants/adapter/files.ts';
import { readExport } from '#/features/tenants/adapter/tenants.ts';
import { EXPORT_MEDIA_TYPE, exportFileName, omittedOf } from '#/features/tenants/service.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface Exported {
  fileName: string;
  bytes: number;
  omitted: readonly string[];
}

export interface TenantExport {
  busy: boolean;
  start: (includeSubjects: boolean) => Promise<GatewayResult<Exported>>;
}

// The document is saved as the text the server sent and kept nowhere else:
// what stays behind is its name, its size and what it says it left out.
export function useExport(tenant: string, now: () => Date = () => new Date()): TenantExport {
  const { gateway } = useTransport();
  const mutation = useMutation({
    mutationFn: async (includeSubjects: boolean): Promise<GatewayResult<Exported>> => {
      const result = await readExport(gateway, tenant, includeSubjects);
      if (!result.ok) return result;
      const { text, contentType } = result.data;
      const fileName = exportFileName(tenant, now());
      saveFile(fileName, text, contentType ?? EXPORT_MEDIA_TYPE);
      return {
        ...result,
        data: { fileName, bytes: new TextEncoder().encode(text).length, omitted: omittedOf(text) },
      };
    },
  });
  return { busy: mutation.isPending, start: (include) => mutation.mutateAsync(include) };
}
