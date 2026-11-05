import { describe, expect, it, vi } from 'vitest';
import { exchangeUpgradeMessage, warnOfStrandedPublicClients } from '#/exchange-upgrade-warning';

describe('exchangeUpgradeMessage', () => {
  it('says nothing when no client is stranded', () => {
    expect(exchangeUpgradeMessage({ count: 0, sample: [] })).toBeNull();
  });

  it('names the count, the clients and the setting that lets them back', () => {
    const message = exchangeUpgradeMessage({
      count: 3,
      sample: [{ tenant: 'acme', clientId: 'spa' }],
    });
    expect(message).toContain('3 public clients');
    expect(message).toContain('acme/spa');
    expect(message).toContain('token_exchange_allowed_for_public');
  });
});

describe('warnOfStrandedPublicClients', () => {
  it('warns once with the finding', async () => {
    const warn = vi.fn();
    await warnOfStrandedPublicClients(
      () => Promise.resolve({ count: 1, sample: [{ tenant: 'acme', clientId: 'spa' }] }),
      { warn },
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('moves on, logging, when the read takes longer than its bound', async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const never = new Promise<{ count: number; sample: [] }>(() => undefined);
      const done = warnOfStrandedPublicClients(() => never, { warn }, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(done).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[1])).toContain('did not finish');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stops the server starting: a failed read is logged and returned from', async () => {
    const warn = vi.fn();
    await expect(
      warnOfStrandedPublicClients(() => Promise.reject(new Error('no column')), { warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
