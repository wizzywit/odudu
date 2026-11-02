import type { MailMessage } from '@odudu/contracts/admin';
import type { Choice } from '#/shared/services/choice';
import { ANY_STATUS, optionalFilter } from '#/shared/services/filters';

export const MAIL_HEADING = 'Delivery';

export const MAIL_RULE =
  'The latest mail this tenant has sent or tried to send, most recent first. A message is failed once every attempt is spent. Never its body, which carries a link that signs somebody in.';

export const NO_MAIL = 'This tenant has no mail of that status.';

export const MASKED_NOTE =
  'Recipient addresses are shortened to their first letter. Holding view-users shows them whole.';

// One page of the latest mail: the panel never reads more until asked.
export const MAIL_PAGE_SIZE = 20;

export const MAIL_STATUS_OPTIONS: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any status' },
  { id: 'queued', label: 'Queued' },
  { id: 'retrying', label: 'Retrying' },
  { id: 'failed', label: 'Failed' },
  { id: 'sent', label: 'Sent' },
];

export function mailQuery(status: string | null): Record<string, string> {
  return { limit: String(MAIL_PAGE_SIZE), ...optionalFilter('status', status) };
}

export type MailTone = 'neutral' | 'active' | 'warning' | 'danger';

export function mailTone(status: MailMessage['status']): MailTone {
  switch (status) {
    case 'sent':
      return 'active';
    case 'failed':
      return 'danger';
    case 'retrying':
      return 'warning';
    case 'queued':
      return 'neutral';
  }
}

export type MailOutcome = { kind: 'sent' | 'next'; at: string } | { kind: 'given-up' };

export function mailOutcome(message: MailMessage): MailOutcome {
  if (message.sent_at !== null) return { kind: 'sent', at: message.sent_at };
  if (message.status === 'failed') return { kind: 'given-up' };
  return { kind: 'next', at: message.next_attempt_at };
}

// Mail is listed newest first, so with no page left unread the last message
// still unsent is the oldest one waiting. Narrowed to one status the rows
// cannot see the other waiting status, so nothing is said.
export function oldestWaiting(
  rows: readonly MailMessage[],
  more: boolean,
  status: string,
): string | null {
  if (more || status !== ANY_STATUS) return null;
  const waiting = rows.filter((row) => row.status === 'queued' || row.status === 'retrying');
  return waiting.at(-1)?.created_at ?? null;
}

export function anyMasked(rows: readonly MailMessage[]): boolean {
  return rows.some((row) => row.to_masked);
}
