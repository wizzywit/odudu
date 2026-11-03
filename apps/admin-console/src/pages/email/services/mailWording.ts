import { MAIL_STATUS_OPTIONS } from '#/pages/email/services/mailQuery';

export const MAIL_WORDS = {
  heading: 'Delivery',
  rule: 'The latest mail this tenant has sent or tried to send, most recent first. A message is failed once every attempt is spent. Never its body, which carries a link that signs somebody in.',
  nothing: 'This tenant has no mail of that status.',
  masked:
    'Recipient addresses are shortened to their first letter. Holding view-users shows them whole.',
  filter: 'Show',
  statuses: MAIL_STATUS_OPTIONS,
  refresh: 'Refresh',
  loading: 'Loading messages',
  failed: 'The mail could not be loaded',
  oldestWaiting: 'Oldest message still waiting was queued',
  noun: 'messages',
  columns: {
    to: 'Recipient',
    subject: 'Subject',
    status: 'Status',
    attempts: 'Attempts',
    lastError: 'Last error',
    queued: 'Queued',
    outcome: 'Outcome',
  },
} as const;

export type MailWords = typeof MAIL_WORDS;

export function mailTableLabel(tenant: string): string {
  return `Mail of ${tenant}`;
}
