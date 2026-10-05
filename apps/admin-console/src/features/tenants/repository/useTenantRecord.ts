import type { Tenant } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { amendTenant, readTenant } from '#/features/tenants/adapter/tenants.ts';
import { tenantRecord } from '#/features/tenants/service.ts';
import {
  recordKey,
  useRecord,
  type RecordEntry,
  type RecordState,
} from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import { isStale } from '#/shared/service/failure.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function useTenantRecord(name: string): RecordState<Tenant> {
  return useRecord({
    tenant: SYSTEM_TENANT,
    record: tenantRecord(name),
    read: (gateway) => readTenant(gateway, name),
  });
}

export interface GeneralValues extends Readonly<Record<string, unknown>> {
  display_name: string;
}

export function saveGeneral(name: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<GeneralValues>) =>
    amendTenant(
      gateway,
      name,
      changes.display_name === undefined ? {} : { display_name: changes.display_name },
      ifMatch,
    );
}

export interface EnabledChange {
  busy: boolean;
  failure: GatewayFailure | null;
  // Answers the result, so the caller can say what came of it.
  set: (enabled: boolean) => Promise<GatewayResult<Tenant>>;
}

// Disabling and enabling are one PATCH on the ETag the record was read
// with; the answer replaces the record, so its sections rebase on it.
export function useTenantEnabled(name: string, etag: string | null): EnabledChange {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = recordKey(SYSTEM_TENANT, tenantRecord(name));
  const mutation = useMutation({
    mutationFn: (enabled: boolean): Promise<GatewayResult<Tenant>> =>
      etag === null
        ? Promise.resolve({ ok: false, kind: 'defect' })
        : amendTenant(gateway, name, { enabled }, etag),
    onSuccess: (result) => {
      if (result.ok) {
        client.setQueryData<RecordEntry<Tenant>>(key, { result, by: 'save' });
      } else if (isStale(result)) {
        client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
      }
    },
  });
  const settled = mutation.data;
  return {
    busy: mutation.isPending,
    failure: settled !== undefined && !settled.ok ? settled : null,
    set: (enabled) => mutation.mutateAsync(enabled),
  };
}
