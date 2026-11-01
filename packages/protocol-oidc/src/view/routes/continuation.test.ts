import { type PendingRequest } from '@odudu/authn-flows';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  continuation,
  lookingUpTenantOnce,
  requestLocale,
  type ContinuationDeps,
  type PageSubject,
} from '#/view/routes/continuation';
import { page } from '#/view/document';

const PENDING: PendingRequest = {
  clientId: 'c',
  redirectUri: 'https://app.example/cb',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'x'.repeat(43),
  codeChallengeMethod: 'S256',
  uiLocales: ['de', 'fr'],
};

function deps(overrides: Partial<ContinuationDeps> = {}): ContinuationDeps {
  return {
    findTenant: () =>
      Promise.resolve({ id: 't1', supportedLocales: ['en', 'fr', 'es'], defaultLocale: null }),
    loadPendingRequest: () => Promise.resolve(PENDING),
    recoverPendingRequest: () => Promise.resolve(PENDING),
    redirectStillRegistered: () => Promise.resolve(true),
    subjectLocale: () => Promise.resolve('es'),
    authenticatedSubject: () => Promise.resolve('s1'),
    ...overrides,
  };
}

// The reply carries the request whose Accept-Language is negotiated.
async function localeFor(
  acceptLanguage: string | undefined,
  d: ContinuationDeps,
  who?: PageSubject,
): Promise<string> {
  const app = Fastify();
  let tag = '';
  app.get('/', async (request, reply) => {
    const { locale, continuing } = await continuation(d, 'acme', 'a1', reply, who);
    tag = locale.tag;
    expect(continuing(page('t', 'b', null, [], locale)).redirectsTo).toBe('https://app.example/cb');
    return reply.send('ok');
  });
  await app.inject({
    url: '/',
    ...(acceptLanguage === undefined ? {} : { headers: { 'accept-language': acceptLanguage } }),
  });
  await app.close();
  return tag;
}

describe('continuation', () => {
  it('negotiates ui_locales ahead of Accept-Language', async () => {
    expect(await localeFor('es', deps())).toBe('fr');
  });

  it('does not read the subject locale before the first factor is verified', async () => {
    expect(
      await localeFor(
        'es',
        deps({ loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: [] }) }),
      ),
    ).toBe('es');
    const withoutHeader = await localeFor(
      undefined,
      deps({ loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: [] }) }),
    );
    expect(withoutHeader).toBe('en');
  });

  it('uses the subject locale once the subject is known, after ui_locales', async () => {
    const noPreference = deps({
      loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: [] }),
    });
    expect(await localeFor(undefined, noPreference, { subject: 's1' })).toBe('es');
    expect(await localeFor(undefined, noPreference, 'authenticated')).toBe('es');
    expect(await localeFor(undefined, deps(), { subject: 's1' })).toBe('fr');
  });

  it('uses the tenant default after the subject and before Accept-Language', async () => {
    const noPreference = deps({
      loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: [] }),
      findTenant: () =>
        Promise.resolve({ id: 't1', supportedLocales: ['en', 'fr', 'es'], defaultLocale: 'fr' }),
    });
    expect(await localeFor('es', noPreference)).toBe('fr');
    expect(await localeFor(undefined, noPreference)).toBe('fr');
    expect(await localeFor(undefined, noPreference, { subject: 's1' })).toBe('es');
  });

  it('offers only what the tenant lists, whatever the browser asks for', async () => {
    const englishOnly = deps({
      loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: ['fr'] }),
      findTenant: () =>
        Promise.resolve({ id: 't1', supportedLocales: ['en'], defaultLocale: null }),
    });
    expect(await localeFor('fr', englishOnly)).toBe('en');
  });

  it('asks for no locale when no subject was bound', async () => {
    const noSubject = deps({
      loadPendingRequest: () => Promise.resolve({ ...PENDING, uiLocales: [] }),
      authenticatedSubject: () => Promise.resolve(null),
    });
    expect(await localeFor(undefined, noSubject, 'authenticated')).toBe('en');
  });
});

describe('continuation clientName', () => {
  async function nameFor(d: ContinuationDeps): Promise<string | undefined> {
    const app = Fastify();
    let name: string | undefined;
    app.get('/', async (_request, reply) => {
      name = await (await continuation(d, 'acme', 'a1', reply)).clientName();
      return reply.send('ok');
    });
    await app.inject({ url: '/' });
    await app.close();
    return name;
  }

  it('reads the name of the client the parked request is for, in its tenant', async () => {
    const seen: unknown[] = [];
    const name = await nameFor(
      deps({
        clientName: (tenantId, clientId) => {
          seen.push([tenantId, clientId]);
          return Promise.resolve('Acme Portal');
        },
      }),
    );
    expect(name).toBe('Acme Portal');
    expect(seen).toEqual([['t1', 'c']]);
  });

  it('asks nothing until the page wants the name', async () => {
    const asked: string[] = [];
    const app = Fastify();
    app.get('/', async (_request, reply) => {
      await continuation(
        deps({
          clientName: (_tenant, clientId) => {
            asked.push(clientId);
            return Promise.resolve('x');
          },
        }),
        'acme',
        'a1',
        reply,
      );
      return reply.send('ok');
    });
    await app.inject({ url: '/' });
    await app.close();
    expect(asked).toEqual([]);
  });

  it('names no client when the lookup is not offered, finds none, or the request is gone', async () => {
    expect(await nameFor(deps())).toBeUndefined();
    expect(await nameFor(deps({ clientName: () => Promise.resolve(null) }))).toBeUndefined();
    expect(
      await nameFor(
        deps({
          loadPendingRequest: () => Promise.resolve(null),
          clientName: () => Promise.resolve('never asked'),
        }),
      ),
    ).toBeUndefined();
  });
});

describe('the theme the request carries', () => {
  async function themes(cookie: string | undefined): Promise<(string | undefined)[]> {
    const app = Fastify();
    const seen: (string | undefined)[] = [];
    app.get('/', async (_request, reply) => {
      seen.push((await continuation(deps(), 'acme', 'a1', reply)).locale.theme);
      seen.push((await continuation(deps(), 'acme', 'a1', reply, 'authenticated')).locale.theme);
      seen.push(requestLocale(reply).theme);
      return reply.send('ok');
    });
    await app.inject({ url: '/', ...(cookie === undefined ? {} : { headers: { cookie } }) });
    await app.close();
    return seen;
  }

  it('reaches the locale of a continuation and of a request alone', async () => {
    expect(await themes('odudu-theme=dark')).toEqual(['dark', 'dark', 'dark']);
  });

  it('is absent without the cookie or with one off the allowlist', async () => {
    expect(await themes(undefined)).toEqual([undefined, undefined, undefined]);
    expect(await themes('odudu-theme=LIGHT')).toEqual([undefined, undefined, undefined]);
  });
});

describe('continuation signInPath', () => {
  async function pathFor(d: ContinuationDeps): Promise<string | null> {
    const app = Fastify();
    let path: string | null = 'unset';
    app.get('/', async (_request, reply) => {
      path = (await continuation(d, 'acme', 'a1', reply)).signInPath;
      return reply.send('ok');
    });
    await app.inject({ url: '/' });
    await app.close();
    return path;
  }

  it('is the authorize path of the parked request, rebuilt without another read', async () => {
    let reads = 0;
    const path = await pathFor(
      deps({
        loadPendingRequest: () => {
          reads += 1;
          return Promise.resolve(PENDING);
        },
      }),
    );
    expect(path).toMatch(/^\/tenants\/acme\/protocol\/openid-connect\/auth\?/u);
    expect(new URL(path ?? '', 'https://x').searchParams.get('client_id')).toBe('c');
    expect(reads).toBe(1);
  });

  it('is null with no parked request and for one a hint binds to a subject', async () => {
    expect(await pathFor(deps({ loadPendingRequest: () => Promise.resolve(null) }))).toBeNull();
    expect(
      await pathFor(
        deps({
          loadPendingRequest: () => Promise.resolve({ ...PENDING, idTokenHintSubject: 's' }),
        }),
      ),
    ).toBeNull();
  });
});

describe('lookingUpTenantOnce', () => {
  it('asks for a tenant once per name and answers the second ask from the first', async () => {
    const findTenant = vi.fn((name: string) => Promise.resolve({ id: `id-${name}` }));
    const deps = lookingUpTenantOnce({ findTenant, other: 1 });
    expect(await deps.findTenant('acme')).toEqual({ id: 'id-acme' });
    expect(await deps.findTenant('acme')).toEqual({ id: 'id-acme' });
    expect(await deps.findTenant('rival')).toEqual({ id: 'id-rival' });
    expect(findTenant).toHaveBeenCalledTimes(2);
    expect(deps.other).toBe(1);
  });

  it('does not carry an answer from one request to the next', async () => {
    const findTenant = vi.fn((name: string) => Promise.resolve(name === '' ? { id: '' } : null));
    await lookingUpTenantOnce({ findTenant }).findTenant('acme');
    await lookingUpTenantOnce({ findTenant }).findTenant('acme');
    expect(findTenant).toHaveBeenCalledTimes(2);
  });
});
