import type { Tenant } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session/index.ts';
import {
  saveGeneral,
  tenantRecord,
  useTenantEnabled,
  type GeneralValues,
} from '#/features/tenants/repository/useTenantRecord.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

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

const SYSTEM_FIXED =
  'system cannot be disabled: it is the tenant every cross-tenant administrator signs in to.';

function refusalMessage(name: string, result: Exclude<GatewayResult<unknown>, { ok: true }>) {
  switch (result.kind) {
    case 'network':
      return `Could not confirm the change to ${name}. It has not been sent again; check its status before trying again.`;
    case 'problem':
      if (result.problem.status === 412) {
        return `${name} changed elsewhere since you opened it. It has been read again; look at it before trying again.`;
      }
      if (result.problem.status === 403) return 'This needs the manage-tenant capability.';
      return result.problem.detail ?? result.problem.title;
    default:
      return 'The console could not make the change. This is a fault in the console, not something you did.';
  }
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
          push({ tone: 'success', message: `${name} is ${next ? 'enabled' : 'disabled'}.` });
          return;
        }
        refusal.report(result, 'manage-tenant');
        setMessage(refusalMessage(name, result));
      })
      .catch(() => {
        setConfirming(false);
        setMessage(refusalMessage(name, { ok: false, kind: 'defect' }));
      });
  };
  return {
    general,
    enabled: {
      fixed: name === SYSTEM_TENANT ? SYSTEM_FIXED : null,
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
