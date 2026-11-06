import { describe, expect, it } from 'vitest';
import type { CredentialStore, RefreshLock } from '#/service/ports';
import { decodeStored, encodeStored } from '#/service/stored-sign-in';
import { StdioError } from '#/service/stdio-error';
import type { TokenSet } from '#/service/token-set';
import { ToolProblem } from '#/service/tool';
import { jwtOf } from '#/testing/jwt';
import { createTokenSource, type TokenSourceDeps } from '#/usecase/token-source';

const ISSUER = 'https://id.example.com/tenants/acme';
const ADMIN = 'urn:odudu:params:admin-api';
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
const AUTHORITY = { issuer: ISSUER, tokenEndpoint: TOKEN_ENDPOINT };
const keptFor = (refreshToken: string, over: Partial<typeof AUTHORITY> = {}) =>
  encodeStored({ refreshToken, ...AUTHORITY, ...over });
const tokenOf = (kept: string | null) =>
  kept === null ? null : (decodeStored(kept)?.refreshToken ?? null);
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
    lock: RefreshLock;
    warn: (line: string) => void;
  }> = {},
) {
  const calls: string[] = [];
  const deps: TokenSourceDeps = {
    now,
    ...(over.lock === undefined ? {} : { lock: over.lock }),
    ...(over.warn === undefined ? {} : { warn: over.warn }),
    authority: () => Promise.resolve(AUTHORITY),
    expectation: { audience: ADMIN, scope },
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
    expect(tokenOf(m.held())).toBe('rt-1');
    clock += 280_000;
    await b.source.bearer('read');
    expect(b.calls).toEqual(['login', 'refresh:rt-1']);
  });

  it('refreshes with the stored token, and keeps the one it was rotated to', async () => {
    const m = memoryStore(keptFor('rt-0'));
    const b = browser('mcp:read', m.store);
    await b.source.bearer('read');
    expect(b.calls).toEqual(['refresh:rt-0']);
    expect(tokenOf(m.held())).toBe('rt-2');
  });

  it('forgets a refresh token the server ended, and signs in again', async () => {
    const m = memoryStore(keptFor('rt-0'));
    const b = browser('mcp:read', m.store, {
      refresh: () => Promise.reject(new StdioError('mcp_grant_ended', 'ended')),
    });
    await b.source.bearer('read');
    expect(m.log).toContain('clear');
    expect(tokenOf(m.held())).toBe('rt-1');
  });

  it('keeps the stored token and reports one line when a refresh fails for any other reason', async () => {
    const m = memoryStore(keptFor('rt-0'));
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
    expect(tokenOf(m.held())).toBe('rt-0');
  });

  it('refuses a token of another issuer before it is used', async () => {
    const m = memoryStore();
    const b = browser('mcp:read', m.store, {
      login: () =>
        Promise.resolve(
          set('mcp:read', { refreshToken: 'rt-x' }, { iss: 'https://evil.example/tenants/acme' }),
        ),
    });
    await expect(b.source.bearer('read')).rejects.toBeInstanceOf(ToolProblem);
    expect(tokenOf(m.held())).toBe('rt-x');
  });

  it('refuses a refreshed token of another issuer, but keeps the token it rotated to', async () => {
    const m = memoryStore(keptFor('rt-0'));
    const b = browser('mcp:read', m.store, {
      refresh: () =>
        Promise.resolve(
          set('mcp:read', { refreshToken: 'rt-x' }, { iss: 'https://evil.example/tenants/acme' }),
        ),
    });
    await expect(b.source.bearer('read')).rejects.toBeInstanceOf(ToolProblem);
    expect(tokenOf(m.held())).toBe('rt-x');
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
    const m = memoryStore(keptFor('rt-0'));
    const b = browser('mcp:write', m.store);
    await b.source.bearer('write');
    await b.source.bearer('read');
    expect(m.log).toEqual([]);
    expect(b.calls).toEqual(['login']);
  });

  it('signs in again when the write token lapses, instead of refreshing', async () => {
    const m = memoryStore(keptFor('rt-0'));
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
      authority: () => Promise.resolve(AUTHORITY),
      expectation: { audience: ADMIN, scope: 'mcp:read' },
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
      authority: () => Promise.resolve(AUTHORITY),
      expectation: { audience: ADMIN, scope: 'mcp:read' },
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
      authority: () => Promise.resolve(AUTHORITY),
      expectation: { audience: ADMIN, scope: 'mcp:write' },
      credential: { kind: 'key', fetch: () => Promise.resolve(set('mcp:write')) },
    });
    await expect(source.bearer('write')).resolves.toEqual(expect.any(String));
  });
});

describe('a source that is told its issuer late, loses a token and is retried', () => {
  it('asks for the authorization server when it first judges a token', async () => {
    let asked = 0;
    const source = createTokenSource({
      now,
      authority: () => {
        asked += 1;
        return Promise.resolve(AUTHORITY);
      },
      expectation: { audience: ADMIN, scope: 'mcp:read' },
      credential: { kind: 'key', fetch: () => Promise.resolve(set('mcp:read')) },
    });
    expect(asked).toBe(0);
    await source.bearer('read');
    expect(asked).toBe(1);
  });

  it('gets another token after the one held is invalidated', async () => {
    const b = browser('mcp:read', null);
    await b.source.bearer('read');
    b.source.invalidate?.();
    await b.source.bearer('read');
    expect(b.calls).toEqual(['login', 'login']);
  });

  it('does not open another sign-in for a minute after one failed', async () => {
    let attempts = 0;
    const b = browser('mcp:read', null, {
      login: () => {
        attempts += 1;
        return Promise.reject(
          new StdioError('mcp_login_refused', 'the sign-in was refused (access_denied)'),
        );
      },
    });
    const first = await b.source.bearer('read').catch((e: unknown) => e);
    expect((first as ToolProblem).message).toContain('access_denied');
    const second = await b.source.bearer('read').catch((e: unknown) => e);
    expect(attempts).toBe(1);
    expect((second as ToolProblem).message).toMatch(/access_denied.*not tried again/u);
    clock += 61_000;
    await b.source.bearer('read').catch(() => undefined);
    expect(attempts).toBe(2);
  });

  it('keeps a rotated refresh token in memory when it cannot be stored, and says so once', async () => {
    const m = memoryStore(keptFor('rt-0'));
    const failing: CredentialStore = {
      ...m.store,
      put: () => Promise.reject(new Error('disk full')),
    };
    const warned: string[] = [];
    const b = browser('mcp:read', failing, { warn: (line) => warned.push(line) });
    await b.source.bearer('read');
    clock += 400_000;
    await b.source.bearer('read');
    expect(b.calls).toEqual(['refresh:rt-0', 'refresh:rt-2']);
    expect(warned).toHaveLength(1);
    expect(warned[0]).not.toContain('rt-');
  });

  it('refreshes inside the lock, reading the store after it was taken and writing before it is let go', async () => {
    const m = memoryStore(keptFor('rt-0'));
    const events: string[] = [];
    const lock: RefreshLock = {
      run: async (work) => {
        events.push('lock');
        const result = await work();
        events.push('unlock');
        return result;
      },
    };
    const logging: CredentialStore = {
      get: () => {
        events.push('get');
        return m.store.get();
      },
      put: (secret) => {
        events.push('put');
        return m.store.put(secret);
      },
      clear: () => m.store.clear(),
    };
    const b = browser('mcp:read', logging, { lock });
    await b.source.bearer('read');
    expect(events).toEqual(['lock', 'get', 'put', 'unlock']);
  });
});

describe('a stored sign-in is only presented to the server it was made at', () => {
  it.each([
    ['another issuer', { issuer: 'https://evil.example/tenants/acme' }],
    ['another token endpoint', { tokenEndpoint: 'https://evil.example/token' }],
  ])(
    'does not hand it to %s: it is forgotten and the person signs in again',
    async (_name, over) => {
      const m = memoryStore(keptFor('rt-secret', over));
      const b = browser('mcp:read', m.store);
      await b.source.bearer('read');
      expect(b.calls).toEqual(['login']);
      expect(m.log).toContain('clear');
      expect(tokenOf(m.held())).toBe('rt-1');
    },
  );

  it('forgets a stored value that is not one this command wrote, without presenting it', async () => {
    const m = memoryStore('rt-raw');
    const b = browser('mcp:read', m.store);
    await b.source.bearer('read');
    expect(b.calls).toEqual(['login']);
  });

  it('keeps what it stores with the server it was issued by', async () => {
    const m = memoryStore();
    const b = browser('mcp:read', m.store);
    await b.source.bearer('read');
    expect(decodeStored(m.held() ?? '')).toEqual({ refreshToken: 'rt-1', ...AUTHORITY });
  });
});
