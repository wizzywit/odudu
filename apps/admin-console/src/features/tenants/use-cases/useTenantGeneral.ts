import type { Tenant } from '@odudu/contracts/admin';
import { useState } from 'react';
import { usePrincipal, useRefusal, isOwnTenant } from '#/entities/session';
import {
  saveGeneral,
  useTenantEnabled,
  type GeneralValues,
} from '#/features/tenants/repository/useTenantRecord';
import { tenantChangeFailure } from '#/features/tenants/services/failure';
import { tenantRecord } from '#/features/tenants/services/tabs';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { enabledText } from '#/shared/services/failure';
import { disableConsequence, disableFixed } from '#/shared/services/tenantEnabled';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { orBlank } from '#/shared/services/format';

export interface EnabledControl {
  // Why it cannot be changed, shown as fixed text instead of a control.
  fixed: string | null;
  enabled: boolean;
  busy: boolean;
  confirming: boolean;
  consequence: string;
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
  const principal = usePrincipal();
  const toast = useToast();
  const general = useSectionSave({
    tenant: SYSTEM_TENANT,
    record: tenantRecord(name),
    section: 'general',
    label: 'General',
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    fields: {
      display_name: { value: orBlank(tenant.display_name), label: 'Display name', kind: 'plain' },
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
          toast.succeeded(enabledText(name, next));
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
      consequence: disableConsequence(name, isOwnTenant(principal, name)),
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
