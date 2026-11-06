import { describe, expect, it } from 'vitest';
import type { CredentialStore } from '#/service/ports';
import { StdioError } from '#/service/stdio-error';
import type { TokenSet } from '#/service/token-set';
import { ToolProblem } from '#/service/tool';
import { jwtOf } from '#/testing/jwt';
import { createTokenSource, type TokenSourceDeps } from '#/usecase/token-source';

const ISSUER = 'https://id.example.com/tenants/acme';
const ADMIN = 'urn:odudu:params:admin-api';
let clock = new Date('2026-11-06T10:00:00Z').getTime();
const now = () => new Date(clock);

function set(
  scope: string,
  over: Partial<TokenSet> = {},
  claims: Record<string, unknown> = {},
): TokenSet {
  return {
    accessToken: jwtOf({ iss: ISSUER, aud: [ADMIN, ISSUER], scope, jti: Math.random(), ...claims }),
    expiresAt: new Date(clock + 300_000),
    scope: scope.split(' '),
    ...over,
  };
}

function memoryStore(initial: string | null = null) {
  const log: string[] = [];
  let held = initial;
  const store: CredentialStore = {
    get: () => {
      log.push('get');
      return Promise.resolve(held);
    },
    put: (secret) => {
      log.push(`put:${secret}`);
      held = secret;
      return Promise.resolve();
    },
    clear: () => {
      log.push('clear');
      held = null;
      return Promise.resolve();
    },
  };
  return { store, log, held: () => held };
}

function browser(
  scope: 'mcp:read' | 'mcp:write',
  store: CredentialStore | null,
  over: Partial<{
    login: () => Promise<TokenSet>;
    refresh: (rt: string) => Promise<TokenSet>;
  }> = {},
) {
  const calls: string[] = [];
  const deps: TokenSourceDeps = {
    now,
    expectation: { issuer: ISSUER, audience: ADMIN, scope },
    credential: {
      kind: 'browser',
      store,
      login:
        over.login ??
        (() => {
          calls.push('login');
          return Promise.resolve(set(scope, { refreshToken: 'rt-1' }));
        }),
      refresh:
        over.refresh ??
        ((rt) => {
          calls.push(`refresh:${rt}`);
          return Promise.resolve(set(scope, { refreshToken: 'rt-2' }));
        }),
    },
  };
  return { source: createTokenSource(deps), calls };
}

describe('a read-only run that signs in with a browser', () => {
  it('signs in when nothing is stored, keeps the refresh token, and reuses the access token until it nears expiry', async () => {
    const m = memoryStore();
    const b = browser('mcp:read', m.store);
    const first = await b.source.bearer('read');
    expect(await b.source.bearer('read')).toBe(first);
    expect(b.calls).toEqual(['login']);
    expect(m.held()).toBe('rt-1');
    clock += 280_000;
    await b.source.bearer('read');
    expect(b.calls).toEqual(['login', 'refresh:rt-1']);
  });

  it('refreshes with the stored token, and keeps the one it was rotated to', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:read', m.store);
    await b.source.bearer('read');
    expect(b.calls).toEqual(['refresh:rt-0']);
    expect(m.held()).toBe('rt-2');
  });

  it('forgets a refresh token the server ended, and signs in again', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:read', m.store, {
      refresh: () => Promise.reject(new StdioError('mcp_grant_ended', 'ended')),
    });
    await b.source.bearer('read');
    expect(m.log).toContain('clear');
    expect(m.held()).toBe('rt-1');
  });

  it('keeps the stored token and reports one line when a refresh fails for any other reason', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:read', m.store, {
      refresh: () =>
        Promise.reject(
          new StdioError('mcp_unreachable', 'the authorization server could not be reached'),
        ),
    });
    const error = await b.source.bearer('read').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolProblem);
    expect((error as ToolProblem).status).toBe(401);
    expect((error as ToolProblem).message).toContain('could not be reached');
    expect(m.held()).toBe('rt-0');
  });

  it('refuses a token of another issuer before it is used or stored', async () => {
    const m = memoryStore();
    const b = browser('mcp:read', m.store, {
      login: () =>
        Promise.resolve(
          set('mcp:read', { refreshToken: 'rt-x' }, { iss: 'https://evil.example/tenants/acme' }),
        ),
    });
    await expect(b.source.bearer('read')).rejects.toBeInstanceOf(ToolProblem);
    expect(m.held()).toBeNull();
  });

  it('refuses a refreshed token of another issuer and stores nothing from it', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:read', m.store, {
      refresh: () =>
        Promise.resolve(
          set('mcp:read', { refreshToken: 'rt-x' }, { iss: 'https://evil.example/tenants/acme' }),
        ),
    });
    await expect(b.source.bearer('read')).rejects.toBeInstanceOf(ToolProblem);
    expect(m.held()).toBe('rt-0');
  });

  it('is refused a write, and holds no token that could', async () => {
    const b = browser('mcp:read', memoryStore().store);
    await expect(b.source.bearer('write')).rejects.toMatchObject({
      problemType: 'mcp:insufficient_scope',
    });
    expect(b.calls).toEqual([]);
  });

  it('runs one sign-in for calls made at the same time', async () => {
    const b = browser('mcp:read', memoryStore().store);
    await Promise.all([b.source.bearer('read'), b.source.bearer('read'), b.source.bearer('read')]);
    expect(b.calls).toEqual(['login']);
  });

  it('works without a store, and signs in each time the token lapses', async () => {
    const b = browser('mcp:read', null);
    await b.source.bearer('read');
    clock += 400_000;
    await b.source.bearer('read');
    expect(b.calls).toEqual(['login', 'login']);
  });
});

describe('a run that allows writes', () => {
  it('neither reads nor writes the credential store, even one that holds a refresh token', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:write', m.store);
    await b.source.bearer('write');
    await b.source.bearer('read');
    expect(m.log).toEqual([]);
    expect(b.calls).toEqual(['login']);
  });

  it('signs in again when the write token lapses, instead of refreshing', async () => {
    const m = memoryStore('rt-0');
    const b = browser('mcp:write', m.store);
    await b.source.bearer('write');
    clock += 400_000;
    await b.source.bearer('write');
    expect(b.calls).toEqual(['login', 'login']);
  });

  it('never keeps a refresh token that comes with an mcp:write token', async () => {
    const m = memoryStore();
    const b = browser('mcp:write', m.store, {
      login: () => Promise.resolve(set('mcp:write', { refreshToken: 'rt-leak' })),
    });
    await b.source.bearer('write');
    expect(m.held()).toBeNull();
    expect(m.log).toEqual([]);
  });
});

describe('a run with a service account key', () => {
  it('asks for a token with the key, reuses it until it nears expiry, and keeps nothing', async () => {
    let fetched = 0;
    const source = createTokenSource({
      now,
      expectation: { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' },
      credential: {
        kind: 'key',
        fetch: () => {
          fetched += 1;
          return Promise.resolve(set('mcp:read'));
        },
      },
    });
    const first = await source.bearer('read');
    expect(await source.bearer('read')).toBe(first);
    expect(fetched).toBe(1);
    clock += 290_000;
    await source.bearer('read');
    expect(fetched).toBe(2);
  });

  it('refuses a token of another issuer', async () => {
    const source = createTokenSource({
      now,
      expectation: { issuer: ISSUER, audience: ADMIN, scope: 'mcp:read' },
      credential: {
        kind: 'key',
        fetch: () =>
          Promise.resolve(set('mcp:read', {}, { iss: 'https://evil.example/tenants/acme' })),
      },
    });
    await expect(source.bearer('read')).rejects.toBeInstanceOf(ToolProblem);
  });

  it('asks for mcp:write only when the run allows writes', async () => {
    const source = createTokenSource({
      now,
      expectation: { issuer: ISSUER, audience: ADMIN, scope: 'mcp:write' },
      credential: { kind: 'key', fetch: () => Promise.resolve(set('mcp:write')) },
    });
    await expect(source.bearer('write')).resolves.toEqual(expect.any(String));
  });
});
