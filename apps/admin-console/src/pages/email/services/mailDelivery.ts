import type { MailMessage } from '@odudu/contracts/admin';
import { ANY_STATUS } from '#/shared/lib/services/filters';
import { attemptsText } from '#/shared/lib/services/format';

type MailTone = 'neutral' | 'active' | 'warning' | 'danger';

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

const OUTCOME_TEXT = { sent: 'sent', next: 'next try', 'given-up': 'gave up' } as const;

// One message as the table draws it.
export interface MailRow {
  id: string;
  to: string;
  subject: string;
  status: MailMessage['status'];
  tone: MailTone;
  attempts: string;
  lastError: string;
  queuedAt: string;
  // What became of it, and when; no time once every attempt is spent.
  outcome: { text: string; at: string | null };
}

export function mailRows(messages: readonly MailMessage[]): readonly MailRow[] {
  return messages.map((message) => {
    const outcome = mailOutcome(message);
    return {
      id: message.id,
      to: message.to,
      subject: message.subject,
      status: message.status,
      tone: mailTone(message.status),
      attempts: attemptsText(message.attempts),
      lastError: message.last_error ?? '—',
      queuedAt: message.created_at,
      outcome: {
        text: OUTCOME_TEXT[outcome.kind],
        at: outcome.kind === 'given-up' ? null : outcome.at,
      },
    };
  });
}
