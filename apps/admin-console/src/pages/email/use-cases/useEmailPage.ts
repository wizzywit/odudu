import type { SmtpConfig } from '@odudu/contracts/admin';
import { type Area } from '#/entities/area';
import { useSmtpRecord } from '#/pages/email/repository/useSmtpRecord';
import { EMAIL_WORDS, emailArea, type EmailWords } from '#/pages/email/services/emailWords';
import type { RecordState } from '#/shared/repository/useRecord';

// The gate wraps the page, so it takes the area and the title before anything is read.
export function useEmailArea(): { area: Area; title: string; description: string } {
  return { ...emailArea(), description: EMAIL_WORDS.description };
}

export function useEmailPage(tenant: string): {
  record: RecordState<SmtpConfig>;
  words: EmailWords;
} {
  return { record: useSmtpRecord(tenant), words: EMAIL_WORDS };
}
