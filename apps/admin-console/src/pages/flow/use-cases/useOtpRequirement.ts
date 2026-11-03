import type { Settings } from '@odudu/contracts/admin';
import { useRefusal } from '#/entities/session';
import { flowSaves, type OtpValues } from '#/pages/flow/repository/useFlowRecord';
import {
  describeOtp,
  hasOtpStep,
  OTP_FIELD_LABEL,
  OTP_TITLE,
  otpReading,
  otpRequired,
} from '#/pages/flow/services/otp';
import type { Step } from '#/pages/flow/services/steps';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { TENANT_SETTINGS_RECORD } from '#/entities/tenant';

export interface OtpRequirement {
  save: SectionSave<OtpValues>;
  // Whom the step asks, as the saved setting has it.
  reading: string;
  // The flow has a one-time password step, so the setting has an effect.
  hasStep: boolean;
}

export function useOtpRequirement({
  tenant,
  data,
  etag,
  gone,
  steps,
}: {
  tenant: string;
  data: Settings;
  steps: readonly Step[];
  etag: string;
  gone: boolean;
}): OtpRequirement {
  const refusal = useRefusal(tenant);
  const saves = flowSaves(tenant);
  const save = useSectionSave({
    tenant,
    record: TENANT_SETTINGS_RECORD,
    section: 'otp',
    label: OTP_TITLE,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: {
      otp_required: {
        value: otpRequired(data),
        label: OTP_FIELD_LABEL,
        kind: 'plain',
        describe: describeOtp,
      },
    },
    save: saves.otp,
  });
  return { save, reading: otpReading(otpRequired(data)), hasStep: hasOtpStep(steps) };
}
