import { describe, expect, it } from 'vitest';
import { decideAccess, isSignedIn, loginRedirectPath, matchesPaths } from '#/services/auth-gate';

describe('matchesPaths', () => {
  it('matches whole segments', () => {
    expect(matchesPaths('/dashboard', ['/dashboard'])).toBe(true);
    expect(matchesPaths('/dashboard/settings', ['/dashboard'])).toBe(true);
    expect(matchesPaths('/dashboard2', ['/dashboard'])).toBe(false);
    expect(matchesPaths('/other', ['/dashboard'])).toBe(false);
  });

  it('matches the root only when asked to', () => {
    expect(matchesPaths('/', ['/dashboard'])).toBe(false);
    expect(matchesPaths('/', ['/'])).toBe(true);
    expect(matchesPaths('/anything', ['/'])).toBe(true);
  });

  it('matches nothing without paths', () => {
    expect(matchesPaths('/dashboard', [])).toBe(false);
  });
});

describe('decideAccess', () => {
  const signedIn = (value: boolean) => () => Promise.resolve(value);
  const base = { paths: ['/dashboard'], mountPath: '/api/auth' };

  it('lets an unmatched path through without asking whether anyone is signed in', async () => {
    let asked = 0;
    const verdict = await decideAccess({
      ...base,
      pathname: '/public',
      signedIn: () => {
        asked += 1;
        return Promise.resolve(false);
      },
    });
    expect(verdict).toBe('pass');
    expect(asked).toBe(0);
  });

  it('lets a signed-in request through', async () => {
    expect(await decideAccess({ ...base, pathname: '/dashboard', signedIn: signedIn(true) })).toBe(
      'pass',
    );
  });

  it('sends an anonymous request for a matched path to sign in', async () => {
    expect(
      await decideAccess({ ...base, pathname: '/dashboard/x', signedIn: signedIn(false) }),
    ).toBe('sign-in');
  });

  it('never sends the sign-in routes themselves to sign in', async () => {
    const everything = { paths: ['/'], mountPath: '/api/auth' };
    for (const pathname of ['/api/auth/login', '/api/auth/callback', '/api/auth']) {
      expect(await decideAccess({ ...everything, pathname, signedIn: signedIn(false) })).toBe(
        'pass',
      );
    }
    expect(
      await decideAccess({ ...everything, pathname: '/api/authors', signedIn: signedIn(false) }),
    ).toBe('sign-in');
  });
});

describe('isSignedIn', () => {
  const ID = 'C'.repeat(43);
  const record = { kind: 'session' as const, tokens: {} as never, createdAt: 0 };

  it('takes a well-formed id for a session when there is no store', async () => {
    expect(await isSignedIn(ID, undefined)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'short',
    'a b'.repeat(20),
    'A'.repeat(300),
    'B'.repeat(42),
    'B'.repeat(44),
  ])('takes %j for no session', async (id) => {
    expect(await isSignedIn(id, undefined)).toBe(false);
  });

  it('asks the store, and counts only a session record', async () => {
    expect(await isSignedIn(ID, () => Promise.resolve(record))).toBe(true);
    expect(await isSignedIn(ID, () => Promise.resolve(undefined))).toBe(false);
    expect(
      await isSignedIn(ID, () =>
        Promise.resolve({ kind: 'login' as const, pending: {} as never, createdAt: 0 }),
      ),
    ).toBe(false);
  });

  it('asks the store under the key the BFF keeps a session by', async () => {
    const keys: string[] = [];
    await isSignedIn(ID, (key) => {
      keys.push(key);
      return Promise.resolve(record);
    });
    expect(keys).toEqual([`session:${ID}`]);
  });

  it('does not ask the store about a malformed id', async () => {
    let asked = 0;
    await isSignedIn('x', () => {
      asked += 1;
      return Promise.resolve(record);
    });
    expect(asked).toBe(0);
  });
});

describe('loginRedirectPath', () => {
  it('carries the path and query the person asked for', () => {
    expect(loginRedirectPath('/api/auth/login', '/dashboard', '?tab=2')).toBe(
      '/api/auth/login?returnTo=%2Fdashboard%3Ftab%3D2',
    );
  });

  it('falls back to the root for a path that is not a safe return target', () => {
    expect(loginRedirectPath('/api/auth/login', '//evil.example/x', '')).toBe(
      '/api/auth/login?returnTo=%2F',
    );
    expect(loginRedirectPath('/api/auth/login', '/\\evil.example', '')).toBe(
      '/api/auth/login?returnTo=%2F',
    );
  });
});
