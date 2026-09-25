import { describe, expect, it } from 'vitest';
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

describe('sendTestMessage', () => {
  // Takes the record itself, never a database handle or transaction — the
  // route reads inside withTenant and calls this only once that has
  // returned, so a slow or unreachable host can never hold a pooled tenant
  // connection open for the length of the attempt.
  it('reports the transport failure without needing a transaction at all', async () => {
    const outcome = await sendTestMessage(RECORD, new Uint8Array(32), 'ops@example.test');

    expect(outcome.kind).toBe('send_failed');
  });
});
