import { createMemoryStore } from '@odudu-io/bff';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeIssuer, type FakeIssuer } from '#test/fake-issuer';
import { makeHandlers, SESSION_COOKIE, signIn, START, type Clock } from '#test/harness';

// `cookies()` reads the request AsyncLocalStorage that only a running Next
// server fills, so these tests stand in a cookie jar that records every write.
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writes: [] as string[],
}));

vi.mock('next/headers.js', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [...jar.values].map(([name, value]) => ({ name, value })),
      set: () => {
        jar.writes.push('set');
      },
      delete: () => {
        jar.writes.push('delete');
      },
    }),
}));

let fake: FakeIssuer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeIssuer();
  clock = { now: START };
  jar.values.clear();
  jar.writes.length = 0;
});
afterEach(async () => {
  await fake.close();
});

function browserHolds(cookie: string): void {
  const [name = '', value = ''] = cookie.split('=');
  jar.values.set(name, value);
}

describe('getSession', () => {
  it('returns the claims of the signed-in browser and nothing else', async () => {
    const handlers = makeHandlers(fake, clock);
    browserHolds((await signIn(handlers, fake)).cookie);
    const session = await handlers.getSession();
    expect(session).toEqual({
      claims: expect.objectContaining({ sub: 'subject-1', name: 'Ada Lovelace' }) as unknown,
    });
    expect(Object.keys(session ?? {})).toEqual(['claims']);
    const text = JSON.stringify(session);
    expect(text).not.toContain('access-token-secret-1');
    expect(text).not.toContain('refresh-token-secret-1');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./u);
  });

  it('returns null without a cookie', async () => {
    expect(await makeHandlers(fake, clock).getSession()).toBeNull();
  });

  it('returns null for a cookie the store does not know', async () => {
    const handlers = makeHandlers(fake, clock);
    jar.values.set(SESSION_COOKIE, 'A'.repeat(43));
    expect(await handlers.getSession()).toBeNull();
  });

  it('returns null for a cookie that is not an id', async () => {
    jar.values.set(SESSION_COOKIE, 'x');
    expect(await makeHandlers(fake, clock).getSession()).toBeNull();
  });

  it('returns null once the session has expired for good', async () => {
    fake.issueRefreshToken = false;
    const handlers = makeHandlers(fake, clock);
    browserHolds((await signIn(handlers, fake)).cookie);
    expect(await handlers.getSession()).not.toBeNull();
    clock.now += 2 * 60 * 60 * 1000;
    expect(await handlers.getSession()).toBeNull();
  });

  it('returns null after the session is signed out', async () => {
    const handlers = makeHandlers(fake, clock);
    const { cookie } = await signIn(handlers, fake);
    browserHolds(cookie);
    await handlers.POST(
      new Request('https://app.example/api/auth/logout', {
        method: 'POST',
        headers: { 'x-odudu-bff': '1', origin: 'https://app.example', cookie },
      }),
    );
    expect(await handlers.getSession()).toBeNull();
  });

  it('reads the cookie under the name the BFF was given', async () => {
    const handlers = makeHandlers(fake, clock, { cookieName: '__Host-shop' });
    const { cookie } = await signIn(handlers, fake, undefined, '__Host-shop');
    browserHolds(cookie);
    expect(await handlers.getSession()).not.toBeNull();
  });

  it('never writes a cookie, signed in or not', async () => {
    const handlers = makeHandlers(fake, clock);
    await handlers.getSession();
    browserHolds((await signIn(handlers, fake)).cookie);
    await handlers.getSession();
    clock.now += 2 * 60 * 60 * 1000;
    await handlers.getSession();
    expect(jar.writes).toEqual([]);
  });

  it('shares the default store between handlers of one configuration', async () => {
    const one = makeHandlers(fake, clock);
    const other = makeHandlers(fake, clock);
    browserHolds((await signIn(one, fake)).cookie);
    expect(await one.getSession()).not.toBeNull();
    expect(await other.getSession()).not.toBeNull();
  });

  it('keeps the default stores of two configurations apart', async () => {
    const one = makeHandlers(fake, clock);
    const other = makeHandlers(fake, clock, { clientId: 'web2' });
    browserHolds((await signIn(one, fake)).cookie);
    expect(await other.getSession()).toBeNull();
  });

  it('keeps a store of its own to itself', async () => {
    const own = makeHandlers(fake, clock, { store: createMemoryStore() });
    const shared = makeHandlers(fake, clock);
    browserHolds((await signIn(own, fake)).cookie);
    expect(await own.getSession()).not.toBeNull();
    expect(await shared.getSession()).toBeNull();
  });
});
