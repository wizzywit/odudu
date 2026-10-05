import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { holds } from '#/features/shell';
import { useExport, type Exported } from '#/features/tenants/repository/useExport.ts';
import { fileSize } from '#/features/tenants/service.ts';
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

const EXPORT_NEEDS: readonly AdminCapability[] = ['manage-tenant', 'manage-clients'];

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
  const needs = held === undefined ? [] : EXPORT_NEEDS.filter((c) => !holds(held, c));
  const subjectsNeed = held !== undefined && !holds(held, 'view-users') ? 'view-users' : null;
  const start = (): void => {
    setMessage(null);
    const withSubjects = includeSubjects && subjectsNeed === null;
    exporter
      .start(withSubjects)
      .then((result) => {
        if (result.ok) {
          const size = fileSize(result.data.bytes);
          setSaved({ ...result.data, size });
          push({ tone: 'success', message: `Saved ${result.data.fileName}.` });
          return;
        }
        setSaved(null);
        if (refusal.report(result, withSubjects ? 'view-users' : 'manage-clients')) {
          setMessage(
            `The export needs manage-tenant and manage-clients${withSubjects ? ', and view-users with subjects' : ''}.`,
          );
          return;
        }
        if (result.kind === 'problem') {
          setMessage(result.problem.detail ?? result.problem.title);
          return;
        }
        setMessage('The export could not be read. Nothing was saved; try again.');
      })
      .catch(() => {
        setMessage('The export could not be read. Nothing was saved; try again.');
      });
  };
  return {
    needs,
    subjectsNeed,
    includeSubjects: includeSubjects && subjectsNeed === null,
    setIncludeSubjects,
    busy: exporter.busy,
    saved,
    message,
    start,
  };
}
