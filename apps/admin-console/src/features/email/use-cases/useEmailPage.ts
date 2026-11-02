import type { SmtpConfig } from '@odudu/contracts/admin';
import { useSmtpRecord } from '#/features/email/repository/useSmtpRecord';
import type { RecordState } from '#/shared/repository/useRecord';

export function useEmailPage(tenant: string): RecordState<SmtpConfig> {
  return useSmtpRecord(tenant);
}
