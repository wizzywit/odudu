import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useExport } from '#/features/tenants/repository/useExport.ts';
import {
  exportBlame,
  exportFailureText,
  exportNeeds,
  exportsSubjects,
  fileSize,
  savedText,
  type Exported,
} from '#/features/tenants/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export interface TenantExportState {
  // The capabilities whoami says are missing, each named rather than refused.
  needs: readonly AdminCapability[];
  subjectsNeed: AdminCapability | null;
  includeSubjects: boolean;
  setIncludeSubjects: (include: boolean) => void;
  busy: boolean;
  saved: (Exported & { size: string }) | null;
  message: string | null;
  start: () => void;
}

// `authority` is the tenant whoami is asked about: the target's own for a
// tenant administrator, `system` for a system administrator's tenant record.
export function useTenantExport(target: string, authority: string): TenantExportState {
  const held = useAuthority(authority);
  const refusal = useRefusal(authority);
  const push = useToasts((queue) => queue.push);
  const exporter = useExport(target);
  const [includeSubjects, setIncludeSubjects] = useState(false);
  const [saved, setSaved] = useState<TenantExportState['saved']>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { needs, subjectsNeed } = exportNeeds(held);
  const withSubjects = exportsSubjects(includeSubjects, subjectsNeed);
  const start = (): void => {
    setMessage(null);
    exporter
      .start(withSubjects)
      .then((result) => {
        if (result.ok) {
          setSaved({ ...result.data, size: fileSize(result.data.bytes) });
          push({ tone: 'success', message: savedText(result.data.fileName) });
          return;
        }
        setSaved(null);
        const refused = refusal.report(result, exportBlame(withSubjects));
        setMessage(exportFailureText(result, withSubjects, refused));
      })
      .catch(() => {
        setMessage(exportFailureText({ ok: false, kind: 'defect' }, withSubjects, false));
      });
  };
  return {
    needs,
    subjectsNeed,
    includeSubjects: withSubjects,
    setIncludeSubjects,
    busy: exporter.busy,
    saved,
    message,
    start,
  };
}
