import type { SmtpConfig } from '#/entities/mail-relay';
import { readSmtp } from '#/entities/mail-relay';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';

export const SMTP_RECORD = 'smtp';

export function useSmtpRecord(tenant: string): RecordState<SmtpConfig> {
  return useRecord({
    tenant,
    record: SMTP_RECORD,
    read: (gateway) => readSmtp(gateway, tenant),
  });
}
