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
      'ops@example.test',
    );

    expect(outcome.kind).toBe('send_failed');
  });

  it('refuses a loopback host before any transport exists to report on', async () => {
    const outcome = await sendTestMessage(
      { ...RECORD, host: '127.0.0.1' },
      KEK,
      admitting(),
      'ops@example.test',
    );

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
      'ops@example.test',
    );

    expect(outcome.kind).toBe('refused_destination');
  });
});
