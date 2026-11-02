import type { ListExecutionsResponse } from '@odudu/contracts/admin';
import { replaceFlow, readFlow } from '#/features/flow/adapter/flow';
import type { Step } from '#/features/flow/services/steps';
import { amendTenantSettings } from '#/shared/adapter/tenantSettings';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway } from '#/shared/transport/gateway';

export const FLOW_RECORD = 'flow';

export interface StepValues extends Readonly<Record<string, unknown>> {
  steps: readonly Step[];
}

export interface OtpValues extends Readonly<Record<string, unknown>> {
  otp_required: boolean;
}

export function useFlowRecord(tenant: string): RecordState<ListExecutionsResponse> {
  return useRecord({
    tenant,
    record: FLOW_RECORD,
    read: (gateway) => readFlow(gateway, tenant),
  });
}

export function flowSaves(tenant: string) {
  return {
    steps: (gateway: Gateway, { values, ifMatch }: SaveInput<StepValues>) =>
      replaceFlow(gateway, tenant, [...values.steps], ifMatch),
    otp: (gateway: Gateway, { values, ifMatch }: SaveInput<OtpValues>) =>
      amendTenantSettings(gateway, tenant, { otp_required: values.otp_required }, ifMatch),
  };
}
