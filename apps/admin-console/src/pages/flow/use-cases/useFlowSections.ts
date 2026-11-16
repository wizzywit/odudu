import type { Settings } from '#/entities/tenant';
import type { ListExecutionsResponse } from '#/pages/flow/types/executions';
import { useTenantSettingsRead } from '#/entities/tenant';
import { useFlowRecord } from '#/pages/flow/repository/useFlowRecord';
import { flowPage, type FlowWords } from '#/pages/flow/services/flowWording';
import { otpRead, settingsFailed, type OtpRead } from '#/pages/flow/services/flowRecords';
import { readingOf } from '#/pages/flow/services/otp';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export interface FlowSections {
  flow: RecordState<ListExecutionsResponse>;
  words: FlowWords;
  // Whom the one-time password step asks, once the settings are read.
  reading: string | null;
  // The tenant's settings, which a step's own settings default to.
  tenantSettings: Settings | undefined;
  // The settings could not be read, so the section for them is not offered.
  unread: boolean;
  otp: OtpRead | null;
}

export function useFlowSections(tenant: string): FlowSections {
  const flow = useFlowRecord(tenant);
  const settings = useTenantSettingsRead(tenant);
  return {
    flow,
    words: flowPage().words,
    reading: readingOf(settings.data),
    tenantSettings: settings.data,
    unread: settingsFailed(settings.status),
    otp: otpRead(settings),
  };
}
