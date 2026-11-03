import { currentTime } from '#/shared/api/adapter/clock';
import { saveFile } from '#/shared/api/adapter/files';
import { exportKey } from '#/shared/lib/repository/queryKeys';
import { readExport } from '#/pages/tenants/adapter/tenants';
import { TENANT_DOCUMENT_MEDIA_TYPE } from '#/pages/tenants/services/document';
import { exportedOf, exportFileName, type Exported } from '#/pages/tenants/services/export';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

export interface TenantExport {
  busy: boolean;
  start: (includeSubjects: boolean) => Promise<GatewayResult<Exported>>;
}

// The document is saved as the text the server sent and kept nowhere else:
// what stays behind is its name, its size and what it says it left out.
export function useExport(tenant: string, now: () => Date = currentTime): TenantExport {
  const { gateway } = useTransport();
  const fresh = useFreshRead();
  const start = async (includeSubjects: boolean): Promise<GatewayResult<Exported>> => {
    const result = await fresh.read(exportKey(tenant, includeSubjects), () =>
      readExport(gateway, tenant, includeSubjects),
    );
    if (!result.ok) return result;
    const { text, contentType } = result.data;
    const fileName = exportFileName(tenant, now());
    saveFile(fileName, text, contentType ?? TENANT_DOCUMENT_MEDIA_TYPE);
    return { ...result, data: exportedOf(fileName, text) };
  };
  return { busy: fresh.pending, start };
}
