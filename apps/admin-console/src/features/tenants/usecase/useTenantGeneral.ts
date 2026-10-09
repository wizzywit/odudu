import type { Tenant } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import {
  saveGeneral,
  useTenantEnabled,
  type GeneralValues,
} from '#/features/tenants/repository/useTenantRecord.ts';
import { disableFixed, tenantChangeFailure, tenantRecord } from '#/features/tenants/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { enabledText } from '#/shared/service/failure.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export interface EnabledControl {
  // Why it cannot be changed, shown as fixed text instead of a control.
  fixed: string | null;
  enabled: boolean;
  busy: boolean;
  confirming: boolean;
  message: string | null;
  ask: () => void;
  cancel: () => void;
  disable: () => void;
  enable: () => void;
}

export interface TenantGeneral {
  general: SectionSave<GeneralValues>;
  enabled: EnabledControl;
}

export function useTenantGeneral(
  name: string,
  tenant: Tenant,
  etag: string,
  gone: boolean,
): TenantGeneral {
  const refusal = useRefusal(SYSTEM_TENANT);
  const push = useToasts((queue) => queue.push);
  const general = useSectionSave({
    tenant: SYSTEM_TENANT,
    record: tenantRecord(name),
    section: 'general',
    label: 'General',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-tenant');
    },
    fields: {
      display_name: { value: tenant.display_name ?? '', label: 'Display name', kind: 'plain' },
    },
    save: saveGeneral(name),
  });
  const change = useTenantEnabled(name, etag);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (next: boolean): void => {
    if (change.busy) return;
    setMessage(null);
    change
      .set(next)
      .then((result) => {
        setConfirming(false);
        if (result.ok) {
          push({ tone: 'success', message: enabledText(name, next) });
          return;
        }
        refusal.report(result, 'manage-tenant');
        setMessage(tenantChangeFailure(name, result));
      })
      .catch(() => {
        setConfirming(false);
        setMessage(tenantChangeFailure(name, { ok: false, kind: 'defect' }));
      });
  };
  return {
    general,
    enabled: {
      fixed: disableFixed(name),
      enabled: tenant.enabled,
      busy: change.busy,
      confirming,
      message,
      ask: () => {
        setMessage(null);
        setConfirming(true);
      },
      cancel: () => {
        setConfirming(false);
      },
      disable: () => {
        set(false);
      },
      enable: () => {
        set(true);
      },
    },
  };
}
