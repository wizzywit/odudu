import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '#/services/memory-store';
import type { Session } from '#/types';

const session = (createdAt: number): Session => ({
  kind: 'login',
  createdAt,
  pending: {
    issuer: 'https://idp.example',
    clientId: 'c',
    redirectUri: 'https://app.example/cb',
    state: 's',
    nonce: 'n',
    codeVerifier: 'v',
    resources: [],
    idTokenAlg: 'RS256',
  },
});

describe('the memory store', () => {
  it('evicts the oldest at maxSessions and expires idle ones', async () => {
    let now = 0;
    const store = createMemoryStore({ maxSessions: 3, idleMs: 1000, now: () => now });
    await store.set('a', session(1), 60_000);
    await store.set('b', session(2), 60_000);
    await store.set('c', session(3), 60_000);
    await store.set('d', session(4), 60_000);
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('d')).toEqual(session(4));

    now = 900;
    expect(await store.get('b')).toEqual(session(2));
    now = 1500;
    expect(await store.get('b')).toEqual(session(2));
    expect(await store.get('c')).toBeUndefined();
  });

  it('counts a read as use when choosing what to evict', async () => {
    const store = createMemoryStore({ maxSessions: 2, now: () => 0 });
    await store.set('a', session(1), 60_000);
    await store.set('b', session(2), 60_000);
    await store.get('a');
    await store.set('c', session(3), 60_000);
    expect(await store.get('b')).toBeUndefined();
    expect(await store.get('a')).toEqual(session(1));
  });

  it('drops a record kept past its ttl even when it is in use', async () => {
    let now = 0;
    const store = createMemoryStore({ idleMs: 10_000, now: () => now });
    await store.set('a', session(1), 5000);
    now = 4000;
    expect(await store.get('a')).toEqual(session(1));
    now = 5000;
    expect(await store.get('a')).toBeUndefined();
  });

  it('sweeps idle records on insert without a timer', async () => {
    let now = 0;
    const store = createMemoryStore({ maxSessions: 100, idleMs: 1000, now: () => now });
    for (let i = 0; i < 50; i += 1) await store.set(`k${String(i)}`, session(i), 60_000);
    now = 2000;
    await store.set('fresh', session(99), 60_000);
    expect(await store.get('k0')).toBeUndefined();
    expect(await store.get('k49')).toBeUndefined();
    expect(await store.get('fresh')).toEqual(session(99));
  });

  it('never holds more than maxSessions', async () => {
    const store = createMemoryStore({ maxSessions: 5, now: () => 0 });
    for (let i = 0; i < 50; i += 1) await store.set(`k${String(i)}`, session(i), 60_000);
    let live = 0;
    for (let i = 0; i < 50; i += 1) if ((await store.get(`k${String(i)}`)) !== undefined) live += 1;
    expect(live).toBe(5);
  });

  it('forgets a deleted record and tolerates deleting one twice', async () => {
    const store = createMemoryStore({ now: () => 0 });
    await store.set('a', session(1), 60_000);
    await store.delete('a');
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
});
