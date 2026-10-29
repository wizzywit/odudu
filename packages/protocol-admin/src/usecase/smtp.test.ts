import { type EmailMessage } from '@odudu/email';
import { describe, expect, it } from 'vitest';
import { type SmtpDestinationPolicy } from '#/service/smtp-destination';
import { sendTestMessage } from '#/usecase/smtp';

const RECORD = {
  tenantId: 'tenant-1',
  host: 'unreachable.invalid',
  port: 587,
  fromAddress: 'noreply@example.test',
  username: null,
  passwordEncrypted: null,
  starttls: false,
};

const KEK = new Uint8Array(32);

function admitting(...addresses: string[]): SmtpDestinationPolicy {
  return { allowPrivate: false, resolve: () => Promise.resolve(addresses) };
}

describe('sendTestMessage', () => {
  // Takes the record itself, never a database handle or transaction — the
  // route reads inside withTenant and calls this only once that has
  // returned, so a slow or unreachable host can never hold a pooled tenant
  // connection open for the length of the attempt.
  // Port 70000 is out of range, so the socket is refused before a packet
  // leaves and the failure is the transport's own. It has to be: the host is
  // now pinned to the admitted address, and an unroutable one would sit out
  // the transport's whole connection timeout instead of failing offline.
  it('reports the transport failure without needing a transaction at all', async () => {
    const outcome = await sendTestMessage(
      { ...RECORD, port: 70_000 },
      KEK,
      admitting('203.0.113.10'),
      { to: 'ops@example.test', tenantDisplayName: 'Demo', now: new Date() },
    );

    expect(outcome.kind).toBe('send_failed');
  });

  it('refuses a loopback host before any transport exists to report on', async () => {
    const outcome = await sendTestMessage({ ...RECORD, host: '127.0.0.1' }, KEK, admitting(), {
      to: 'ops@example.test',
      tenantDisplayName: 'Demo',
      now: new Date(),
    });

    expect(outcome).toEqual({
      kind: 'refused_destination',
      reason: 'this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address',
    });
  });

  it('refuses a name that resolves inside the perimeter', async () => {
    const outcome = await sendTestMessage(
      { ...RECORD, host: 'metadata.internal' },
      KEK,
      admitting('169.254.169.254'),
      { to: 'ops@example.test', tenantDisplayName: 'Demo', now: new Date() },
    );

    expect(outcome.kind).toBe('refused_destination');
  });
});

describe('sendTestMessage, the mail it sends', () => {
  async function sentAt(instant: string): Promise<EmailMessage> {
    const sent: EmailMessage[] = [];
    const outcome = await sendTestMessage(
      RECORD,
      KEK,
      admitting('203.0.113.10'),
      { to: 'ops@example.test', tenantDisplayName: 'Demo', now: new Date(instant) },
      () =>
        Promise.resolve({
          kind: 'ok',
          sender: {
            send: (message) => {
              sent.push(message);
              return Promise.resolve();
            },
          },
        }),
    );
    expect(outcome.kind).toBe('sent');
    const [message] = sent;
    if (message === undefined) throw new Error('nothing was sent');
    return message;
  }

  it.each([
    ['2026-12-31T23:59:59Z', '2026'],
    ['2027-01-01T00:00:00Z', '2027'],
    ['2031-06-01T12:00:00Z', '2031'],
  ])('carries the year of the time it was given: %s', async (instant, year) => {
    const message = await sentAt(instant);
    expect(message.html).toContain(`\u00a9 ${year} Odudu`);
    expect(message.text).toContain(`\u00a9 ${year} Odudu`);
  });

  it('names the tenant it was sent for', async () => {
    expect((await sentAt('2031-06-01T12:00:00Z')).html).toContain('<bdi>Demo</bdi>');
  });

  it('carries the tenant’s own wording, in the language it offers', async () => {
    const sent: EmailMessage[] = [];
    await sendTestMessage(
      RECORD,
      KEK,
      admitting('203.0.113.10'),
      {
        to: 'ops@example.test',
        tenantDisplayName: 'Demo',
        now: new Date('2026-10-29T00:00:00Z'),
        tenantDefaultLocale: 'en',
        supportedLocales: ['en'],
        overrides: {
          en: { 'smtpTest.heading': 'Acme relay check', 'smtpTest.subject': 'Acme SMTP' },
        },
      },
      () =>
        Promise.resolve({
          kind: 'ok',
          sender: {
            send: (message) => {
              sent.push(message);
              return Promise.resolve();
            },
          },
        }),
    );
    expect(sent[0]?.subject).toBe('Acme SMTP');
    expect(sent[0]?.html).toContain('Acme relay check');
  });
});
