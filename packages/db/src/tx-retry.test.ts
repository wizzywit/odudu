import { describe, expect, it } from 'vitest';
import { type Database } from '#/client';
import { RetryableTransactionError, withTenantRetrying } from '#/tx';

const TENANT = '0192a0a0-0000-7000-8000-000000000001';

function deadlock(): Error {
  return Object.assign(new Error('failed query'), {
    cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
  });
}

// A database whose transaction runs the callback against a handle that accepts
// the tenant binding, and fails the first `failures` runs with `error`.
function database(failures: number, error: () => Error) {
  const state = { runs: 0 };
  const tx = { execute: () => Promise.resolve([]) };
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.runs += 1;
      if (state.runs <= failures) throw error();
      return fn(tx);
    },
  } as unknown as Database;
  return { db, state };
}

const NO_WAIT = { sleep: () => Promise.resolve(), pauseMs: () => 0 };

describe('withTenantRetrying', () => {
  it('runs the transaction again after a deadlock and answers the second attempt', async () => {
    const { db, state } = database(1, deadlock);
    expect(
      await withTenantRetrying(db, TENANT, () => Promise.resolve('done'), undefined, NO_WAIT),
    ).toBe('done');
    expect(state.runs).toBe(2);
  });

  it('runs again after a typed give-up of a lock wait', async () => {
    const { db, state } = database(2, () => new RetryableTransactionError('unsettled'));
    await withTenantRetrying(db, TENANT, () => Promise.resolve(1), undefined, NO_WAIT);
    expect(state.runs).toBe(3);
  });

  it('surfaces the error after three attempts, and not before', async () => {
    const { db, state } = database(3, deadlock);
    await expect(
      withTenantRetrying(db, TENANT, () => Promise.resolve(1), undefined, NO_WAIT),
    ).rejects.toMatchObject({ cause: { code: '40P01' } });
    expect(state.runs).toBe(3);
  });

  it('does not run again for any other error', async () => {
    const { db, state } = database(1, () => new Error('boom'));
    await expect(
      withTenantRetrying(db, TENANT, () => Promise.resolve(1), undefined, NO_WAIT),
    ).rejects.toThrow('boom');
    expect(state.runs).toBe(1);
  });

  it('pauses between attempts by the injected amount', async () => {
    const { db } = database(2, deadlock);
    const pauses: number[] = [];
    await withTenantRetrying(db, TENANT, () => Promise.resolve(1), undefined, {
      pauseMs: (attempt) => attempt * 10,
      sleep: (ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    });
    expect(pauses).toEqual([10, 20]);
  });
});
