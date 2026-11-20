import { createMemoryStore } from '@odudu-io/bff';
import { describe, expect, it } from 'vitest';
import { splitStore, storeKey } from '#/services/split-store';

const session = { kind: 'session' as const, tokens: {} as never, createdAt: 1 };
const login = { kind: 'login' as const, pending: {} as never, createdAt: 2 };

describe('splitStore', () => {
  it('keeps logins and sessions in their own stores', async () => {
    const sessions = createMemoryStore();
    const logins = createMemoryStore();
    const both = splitStore(sessions, logins);
    await both.set('s', session, 60_000);
    await both.set('l', login, 60_000);
    expect(await sessions.get('s')).toEqual(session);
    expect(await sessions.get('l')).toBeUndefined();
    expect(await logins.get('l')).toEqual(login);
    expect(await logins.get('s')).toBeUndefined();
  });

  it('reads either kind back by id', async () => {
    const both = splitStore(createMemoryStore(), createMemoryStore());
    await both.set('s', session, 60_000);
    await both.set('l', login, 60_000);
    expect(await both.get('s')).toEqual(session);
    expect(await both.get('l')).toEqual(login);
    expect(await both.get('missing')).toBeUndefined();
  });

  it('deletes from both', async () => {
    const both = splitStore(createMemoryStore(), createMemoryStore());
    await both.set('s', session, 60_000);
    await both.set('l', login, 60_000);
    await both.delete('s');
    await both.delete('l');
    expect(await both.get('s')).toBeUndefined();
    expect(await both.get('l')).toBeUndefined();
  });

  it('lets a flood of logins push out no session', async () => {
    const both = splitStore(createMemoryStore(), createMemoryStore({ maxSessions: 2 }));
    await both.set('s', session, 60_000);
    for (const id of ['a', 'b', 'c', 'd']) await both.set(id, login, 60_000);
    expect(await both.get('s')).toEqual(session);
  });
});

describe('storeKey', () => {
  const base = { issuer: 'https://id.example/t', clientId: 'web', cookieName: '__Host-odudu' };

  it('is the same for the same configuration', () => {
    expect(storeKey(base)).toBe(storeKey({ ...base }));
  });

  it.each([
    { issuer: 'https://id.example/other' },
    { clientId: 'other' },
    { cookieName: '__Host-other' },
  ])('differs when %j differs', (change) => {
    expect(storeKey({ ...base, ...change })).not.toBe(storeKey(base));
  });
});
