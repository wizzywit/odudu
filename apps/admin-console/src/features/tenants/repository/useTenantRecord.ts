import type { Tenant } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { amendTenant, readTenant } from '#/features/tenants/adapter/tenants';
import { missingIfUnknown } from '#/features/tenants/services/deletion';
import { generalPatch } from '#/features/tenants/services/name';
import { tenantRecord } from '#/features/tenants/services/tabs';
import { recordKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useRecord, type RecordEntry, type RecordState } from '#/shared/repository/useRecord';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import { isStale } from '#/shared/services/failure';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { failureOf } from '#/shared/services/settled';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';

export function useTenantRecord(name: string): RecordState<Tenant> {
  return useRecord({
    tenant: SYSTEM_TENANT,
    record: tenantRecord(name),
    read: async (gateway) => missingIfUnknown(await readTenant(gateway, name)),
  });
}

export interface GeneralValues extends Readonly<Record<string, unknown>> {
  display_name: string;
}

export function saveGeneral(name: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<GeneralValues>) =>
    amendTenant(gateway, name, generalPatch(changes), ifMatch);
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
  const { invalidateExact } = useInvalidate();
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
        invalidateExact(key);
      }
    },
  });
  const settled = mutation.data;
  return {
    busy: mutation.isPending,
    failure: failureOf(settled),
    set: (enabled) => mutation.mutateAsync(enabled),
  };
}
