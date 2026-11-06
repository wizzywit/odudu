import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyedGate, keyedLimitFor, type GateEntry } from '#/view/routes/keyed-gate';

function entered(entry: GateEntry): () => void {
  if (entry.kind !== 'entered') throw new Error(`refused: ${entry.reason}`);
  return entry.release;
}

describe('createKeyedGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never admits more than the limit, and admits the rest in order as slots free', async () => {
    const gate = createKeyedGate(1);
    const first = entered(await gate.acquire());
    const order: number[] = [];
    const second = gate.acquire().then((entry) => {
      order.push(2);
      return entered(entry);
    });
    const third = gate.acquire().then((entry) => {
      order.push(3);
      return entered(entry);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]);
    first();
    const releaseSecond = await second;
    expect(order).toEqual([2]);
    releaseSecond();
    (await third)();
    expect(order).toEqual([2, 3]);
  });

  it('frees a slot once however often its release is called', async () => {
    const gate = createKeyedGate(1, { waitMs: 10 });
    const release = entered(await gate.acquire());
    release();
    release();
    entered(await gate.acquire());
    const next = gate.acquire();
    await vi.advanceTimersByTimeAsync(11);
    expect(await next).toEqual({ kind: 'refused', reason: 'timeout' });
  });

  it('refuses a call that has waited the longest it may, and a later one is still served', async () => {
    const gate = createKeyedGate(1, { waitMs: 50 });
    const held = entered(await gate.acquire());
    const late = gate.acquire();
    await vi.advanceTimersByTimeAsync(51);
    expect(await late).toEqual({ kind: 'refused', reason: 'timeout' });
    held();
    entered(await gate.acquire());
  });

  it('refuses a call when the queue is full', async () => {
    const gate = createKeyedGate(1, { queueMax: 2 });
    entered(await gate.acquire());
    void gate.acquire();
    void gate.acquire();
    expect(await gate.acquire()).toEqual({ kind: 'refused', reason: 'queue_full' });
  });

  it('drops a waiter whose caller has gone, so it takes no slot', async () => {
    const gate = createKeyedGate(1);
    const held = entered(await gate.acquire());
    const abort = new AbortController();
    const gone = gate.acquire(abort.signal);
    const next = gate.acquire();
    abort.abort();
    expect(await gone).toEqual({ kind: 'refused', reason: 'gone' });
    held();
    entered(await next);
  });

  it('refuses a call whose caller is already gone', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await createKeyedGate(1).acquire(abort.signal)).toEqual({
      kind: 'refused',
      reason: 'gone',
    });
  });

  it('refuses every call at a limit of 0', async () => {
    expect(await createKeyedGate(0).acquire()).toEqual({ kind: 'refused', reason: 'disabled' });
  });
});

describe('keyedLimitFor', () => {
  it('keeps two connections per call and one spare; a pool of one carries none', () => {
    expect(keyedLimitFor(10)).toBe(4);
    expect(keyedLimitFor(5)).toBe(2);
    expect(keyedLimitFor(3)).toBe(1);
    expect(keyedLimitFor(2)).toBe(1);
    expect(keyedLimitFor(1)).toBe(0);
  });
});
