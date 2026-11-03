import { AUDIT_EXPORT_MEDIA_TYPE } from '@odudu/contracts/admin';
import { exportAuditEvents } from '#/pages/audit/adapter/auditExport';
import { currentTime } from '#/shared/adapter/clock';
import { saveFile } from '#/shared/adapter/files';
import { auditExportKey } from '#/shared/repository/queryKeys';
import { useFreshRead } from '#/shared/repository/useFreshRead';
import { auditFileName, eventsIn } from '#/pages/audit/services/auditExport';
import { auditQuery } from '#/pages/audit/services/auditAddress';
import { type AuditFilters } from '#/pages/audit/services/auditFilters';
import type { GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

export interface AuditExport {
  busy: boolean;
  start: (filters: AuditFilters) => Promise<GatewayResult<{ fileName: string; events: number }>>;
}

// The export is saved as the text the server sent and kept nowhere else:
// what stays behind is its name and how many events it holds.
export function useAuditExport(tenant: string, now: () => Date = currentTime): AuditExport {
  const { gateway } = useTransport();
  const fresh = useFreshRead();
  const start: AuditExport['start'] = async (filters) => {
    const query = auditQuery(filters);
    const result = await fresh.read(auditExportKey(tenant, query.toString()), () =>
      exportAuditEvents(gateway, tenant, query),
    );
    if (!result.ok) return result;
    const { text, contentType } = result.data;
    const fileName = auditFileName(tenant, now());
    saveFile(fileName, text, contentType ?? AUDIT_EXPORT_MEDIA_TYPE);
    return { ...result, data: { fileName, events: eventsIn(text) } };
  };
  return { busy: fresh.pending, start };
}
