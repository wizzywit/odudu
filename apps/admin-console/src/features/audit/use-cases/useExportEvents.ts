import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useAuditExport } from '#/features/audit/repository/useAuditExport';
import { exportFailureText, savedText } from '#/features/audit/services/auditExport';
import { type AuditFilters } from '#/features/audit/services/auditFilters';
import { useToast } from '#/shared/repository/useToasts';

export interface ExportEvents {
  busy: boolean;
  // What the last export came to, for the line beside the button.
  message: string | null;
  start: () => void;
}

// Exports the events the applied filters match, not what is typed in the form.
export function useExportEvents(tenant: string, filters: AuditFilters): ExportEvents {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const exporter = useAuditExport(tenant);
  const [message, setMessage] = useState<string | null>(null);
  return {
    busy: exporter.busy,
    message,
    start: () => {
      setMessage(null);
      exporter
        .start(filters)
        .then((result) => {
          if (result.ok) {
            const saved = savedText(result.data.fileName, result.data.events);
            setMessage(saved);
            toast.succeeded(saved);
            return;
          }
          setMessage(exportFailureText(result, refusal.report(result, 'view-audit')));
        })
        .catch(() => {
          setMessage(exportFailureText({ ok: false, kind: 'defect' }, false));
        });
    },
  };
}
