import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '#/services/memory-store';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { makeBff, request, signIn, START, type Clock } from '#/testing/harness';
import type { SessionStore } from '#/types';

let fake: FakeServer;
let clock: Clock;
beforeEach(async () => {
  fake = await startFakeServer();
  clock = { now: START };
});
afterEach(async () => {
  await fake.close();
});

const sessionRequest = (cookie: string): Request =>
  request('/auth/session', cookie, { headers: { 'x-odudu-bff': '1' } });

const refreshRequests = (): number =>
  fake.tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token').length;

// What a database or cache shared by two servers would do: one record store,
// and locks that a second taker waits for.
function sharedStore(
  withLock: boolean,
): SessionStore & { held: number; taken: number; keys: string[] } {
  const records = createMemoryStore({ now: () => clock.now });
  const tails = new Map<string, Promise<void>>();
  const store = {
    held: 0,
    taken: 0,
    get: (id: string) => records.get(id),
    set: (...args: Parameters<SessionStore['set']>) => records.set(...args),
    delete: (id: string) => records.delete(id),
    keys: [] as string[],
    async lock(id: string): Promise<() => Promise<void>> {
      store.keys.push(id);
      const previous = tails.get(id) ?? Promise.resolve();
      let open: () => void = () => undefined;
      tails.set(
        id,
        previous.then(
          () =>
            new Promise<void>((resolve) => {
              open = resolve;
            }),
        ),
      );
      await previous;
      store.held += 1;
      store.taken += 1;
      return () => {
        store.held -= 1;
        open();
        return Promise.resolve();
      };
    },
  };
  if (!withLock) delete (store as { lock?: unknown }).lock;
  return store;
}

// A second server process: its own copy of every module, so the OIDC core's
// in-process single flight is not shared with the first.
async function otherProcess(): Promise<typeof makeBff> {
  vi.resetModules();
  return (await import('#/testing/harness')).makeBff;
}

async function twoInstances(store: SessionStore): Promise<{
  cookie: string;
  first: ReturnType<typeof makeBff>;
  second: ReturnType<typeof makeBff>;
}> {
  const first = makeBff(fake, clock, { store });
  const second = (await otherProcess())(fake, clock, { store });
  const { cookie } = await signIn(first, fake);
  clock.now += 890_000;
  fake.refreshDelayMs = 40;
  return { cookie, first, second };
}

describe('two instances over one shared store', () => {
  it('make one refresh when the store has a lock', async () => {
    const store = sharedStore(true);
    const { cookie, first, second } = await twoInstances(store);
    const responses = await Promise.all([
      first.session(sessionRequest(cookie)),
      second.session(sessionRequest(cookie)),
      first.session(sessionRequest(cookie)),
      second.session(sessionRequest(cookie)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(refreshRequests()).toBe(1);
    expect(store.held).toBe(0);
  });

  it('can both refresh when the store has none, and the issuer then refuses one', async () => {
    const { cookie, first, second } = await twoInstances(sharedStore(false));
    const responses = await Promise.all([
      first.session(sessionRequest(cookie)),
      second.session(sessionRequest(cookie)),
    ]);
    expect(refreshRequests()).toBe(2);
    expect(await Promise.all(responses.map((response) => response.json()))).toContainEqual({
      authenticated: false,
    });
  });

  it('lock a key of its own, never the session key', async () => {
    const store = sharedStore(true);
    const { cookie, first } = await twoInstances(store);
    await first.session(sessionRequest(cookie));
    expect(store.keys).toHaveLength(1);
    expect(store.keys[0]).toMatch(/^lock:/u);
  });

  it('release the lock when the refresh fails', async () => {
    const store = sharedStore(true);
    const { cookie, first } = await twoInstances(store);
    fake.tokenError = { error: 'server_error' };
    const down = await first.session(sessionRequest(cookie));
    expect(down.status).toBe(503);
    expect(store.held).toBe(0);
    fake.tokenError = undefined;
    expect((await first.session(sessionRequest(cookie))).status).toBe(200);
    expect(store.held).toBe(0);
  });

  it('answer 503 and keep the session when the lock cannot be had and nothing has been saved', async () => {
    const records = sharedStore(false);
    const store: SessionStore = {
      get: (id) => records.get(id),
      set: (...args) => records.set(...args),
      delete: (id) => records.delete(id),
      lock: () => Promise.resolve(undefined),
    };
    const { cookie, first } = await twoInstances(store);
    const busy = await first.session(sessionRequest(cookie));
    expect(busy.status).toBe(503);
    expect(refreshRequests()).toBe(0);
    expect(busy.headers.getSetCookie()).toHaveLength(0);
  });

  it('use the tokens another instance saved when the lock cannot be had', async () => {
    const records = sharedStore(false);
    let blocked = true;
    const store: SessionStore = {
      get: (id) => records.get(id),
      set: (...args) => records.set(...args),
      delete: (id) => records.delete(id),
      lock: () => Promise.resolve(blocked ? undefined : () => Promise.resolve()),
    };
    const { cookie, first, second } = await twoInstances(store);
    blocked = false;
    expect((await second.session(sessionRequest(cookie))).status).toBe(200);
    blocked = true;
    expect((await first.session(sessionRequest(cookie))).status).toBe(200);
    expect(refreshRequests()).toBe(1);
  });
});
