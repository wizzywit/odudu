import { IDLE_ACCOUNT_COUNT_CAP } from '@odudu/protocol-oidc';
import { describe, expect, it, vi } from 'vitest';
import { idleAccountMessage, warnOfIdleServiceAccounts } from '#/service-account-warning';

describe('idleAccountMessage', () => {
  it('says nothing when no account is idle', () => {
    expect(idleAccountMessage({ count: 0, sample: [] })).toBeNull();
  });

  it('names the count, the clients and how to retire the accounts', () => {
    const message = idleAccountMessage({
      count: 3,
      sample: [{ tenant: 'acme', clientId: 'batch' }],
    });
    expect(message).toContain('3 confidential clients');
    expect(message).toContain('acme/batch');
    expect(message).toContain('grant_types');
  });

  it('reads a count that reached the cap as a lower bound', () => {
    const sample = [{ tenant: 'acme', clientId: 'batch' }];
    expect(idleAccountMessage({ count: IDLE_ACCOUNT_COUNT_CAP, sample })).toContain('at least');
    expect(idleAccountMessage({ count: 3, sample })).not.toContain('at least');
  });
});

describe('warnOfIdleServiceAccounts', () => {
  it('warns once with the finding', async () => {
    const warn = vi.fn();
    await warnOfIdleServiceAccounts(
      () => Promise.resolve({ count: 1, sample: [{ tenant: 'acme', clientId: 'batch' }] }),
      { warn },
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('moves on, logging, when the read takes longer than its bound', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const never = new Promise<{ count: number; sample: [] }>(() => undefined);
      const done = warnOfIdleServiceAccounts(() => never, { warn }, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(done).resolves.toBeUndefined();
      expect(String(warn.mock.calls[0]?.[1])).toContain('did not finish');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stops the server starting: a failed read is logged and returned from', async () => {
    const warn = vi.fn();
    await expect(
      warnOfIdleServiceAccounts(() => Promise.reject(new Error('no column')), { warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
