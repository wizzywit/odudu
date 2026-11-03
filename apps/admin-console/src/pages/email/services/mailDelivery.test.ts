import type { MailMessage } from '@odudu/contracts/admin';
import { ANY_STATUS } from '#/shared/services/filters';
import { describe, expect, it } from 'vitest';
import {
  anyMasked,
  mailOutcome,
  mailRows,
  mailTone,
  oldestWaiting,
} from '#/pages/email/services/mailDelivery';

function message(id: string, status: MailMessage['status'], extra: Partial<MailMessage> = {}) {
  return {
    id,
    to: 'a***@example.org',
    to_masked: true,
    subject: 'Verify your Acme account',
    status,
    attempts: 0,
    last_error: null,
    created_at: `2026-10-1${id}T08:00:00.000Z`,
    next_attempt_at: '2026-10-15T09:00:00.000Z',
    sent_at: null,
    ...extra,
  } satisfies MailMessage;
}

describe('how a status is drawn', () => {
  it('shows a failed message as danger, one still being tried as a warning and one sent as active', () => {
    expect(mailTone('failed')).toBe('danger');
    expect(mailTone('retrying')).toBe('warning');
    expect(mailTone('queued')).toBe('neutral');
    expect(mailTone('sent')).toBe('active');
  });
});

describe('what became of a message', () => {
  it('says when it was sent, when the next attempt is due, or that every attempt is spent', () => {
    expect(mailOutcome(message('1', 'sent', { sent_at: '2026-10-11T08:01:00.000Z' }))).toEqual({
      kind: 'sent',
      at: '2026-10-11T08:01:00.000Z',
    });
    expect(mailOutcome(message('2', 'queued'))).toEqual({
      kind: 'next',
      at: '2026-10-15T09:00:00.000Z',
    });
    expect(mailOutcome(message('3', 'retrying'))).toMatchObject({ kind: 'next' });
    expect(mailOutcome(message('4', 'failed'))).toEqual({ kind: 'given-up' });
  });
});

describe('the oldest message still waiting', () => {
  const rows = [message('3', 'queued'), message('2', 'sent'), message('1', 'retrying')];

  it('is the last waiting one of a list that is complete and unfiltered', () => {
    expect(oldestWaiting(rows, false, ANY_STATUS)).toBe('2026-10-11T08:00:00.000Z');
  });

  it.each(['queued', 'retrying', 'sent', 'failed'])(
    'is never derived from rows narrowed to %s, which cannot see the other waiting status',
    (status) => {
      expect(oldestWaiting(rows, false, status)).toBeNull();
    },
  );

  it('is unknown while more messages are left unread, and none when nothing waits', () => {
    expect(oldestWaiting([message('3', 'queued')], true, ANY_STATUS)).toBeNull();
    expect(
      oldestWaiting([message('3', 'sent'), message('2', 'failed')], false, ANY_STATUS),
    ).toBeNull();
    expect(oldestWaiting([], false, ANY_STATUS)).toBeNull();
  });
});

describe('whether an address is masked', () => {
  it('is true when any listed recipient is', () => {
    expect(anyMasked([message('1', 'sent', { to_masked: false }), message('2', 'sent')])).toBe(
      true,
    );
    expect(anyMasked([message('1', 'sent', { to_masked: false })])).toBe(false);
    expect(anyMasked([])).toBe(false);
  });
});

describe('the rows of the table', () => {
  it('words each message for its columns', () => {
    const [row] = mailRows([
      message('3', 'failed', { attempts: 5, last_error: 'connect ECONNREFUSED' }),
    ]);
    expect(row).toEqual({
      id: '3',
      to: 'a***@example.org',
      subject: 'Verify your Acme account',
      status: 'failed',
      tone: 'danger',
      attempts: '5 attempts',
      lastError: 'connect ECONNREFUSED',
      queuedAt: '2026-10-13T08:00:00.000Z',
      outcome: { text: 'gave up', at: null },
    });
  });

  it('shows a dash for no error, and the time of a send or of the next try', () => {
    const [sent, waiting] = mailRows([
      message('1', 'sent', { sent_at: '2026-10-15T08:01:00.000Z', attempts: 1 }),
      message('2', 'queued'),
    ]);
    expect(sent?.lastError).toBe('—');
    expect(sent?.outcome).toEqual({ text: 'sent', at: '2026-10-15T08:01:00.000Z' });
    expect(waiting?.outcome).toEqual({ text: 'next try', at: '2026-10-15T09:00:00.000Z' });
  });
});
