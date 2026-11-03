import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookies,
  sessionCookies,
} from '../../packages/authn-flows/src/service/session-cookie.js';
import { SessionEntry } from '../../packages/authn-flows/src/service/session-entry.js';
import {
  clearedSignInHandleCookie,
  signInHandleCookie,
} from '../../packages/authn-flows/src/service/sign-in-handle.js';
import {
  clearedLoginCookie,
  clearedRestartCookie,
  clearedSessionCookie,
  loginCookie,
  restartCookie,
  sessionCookie,
} from '../../packages/console-gateway/src/service/cookies.js';
import { themeCookie } from '../../apps/admin-console/src/shared/lib/services/theme.js';

// Every cookie the server (and the console's own script) writes, under TLS and
// without: the prefix its scope allows, Secure, HttpOnly where the script does
// not need to read it, SameSite, a Path, and never a Domain.

interface Writer {
  readonly name: string;
  readonly write: (tls: boolean) => string;
  // `host`: Path=/ so __Host-; `path`: a scoped path so __Secure-; `none`: a
  // preference the page script owns, which takes Secure but no prefix.
  readonly scope: 'host' | 'path' | 'none';
  readonly httpOnly: boolean;
  readonly sameSite: 'Lax' | 'Strict';
  readonly path: string;
}

const SESSION = '0192f2a0-0000-7000-8000-000000000001';
const ENTRY = SessionEntry.issue(SESSION);

const sessionPair = (tls: boolean, index: 0 | 1, empty = false): string =>
  (empty
    ? clearedSessionCookies('acme', tls)
    : sessionCookies({
        tenant: 'acme',
        tls,
        ephemeral: [ENTRY],
        persistent: [ENTRY],
        persistentMaxAgeSeconds: 60,
      }))[index] ?? '';

function host(
  name: string,
  write: (tls: boolean) => string,
  sameSite: 'Lax' | 'Strict' = 'Lax',
): Writer {
  return { name, write, scope: 'host', httpOnly: true, sameSite, path: '/' };
}

const WRITERS: readonly Writer[] = [
  host('SSO session', (t) => sessionPair(t, 0)),
  host('SSO session, persistent (remember me)', (t) => sessionPair(t, 1)),
  host('SSO session, cleared', (t) => sessionPair(t, 0, true)),
  host('SSO session, persistent, cleared', (t) => sessionPair(t, 1, true)),
  {
    name: 'sign-in handle',
    write: (t) => signInHandleCookie('acme', t, SESSION, 'secret', 60),
    scope: 'path',
    httpOnly: true,
    sameSite: 'Lax',
    path: '/tenants/acme/',
  },
  {
    name: 'sign-in handle, cleared',
    write: (t) => clearedSignInHandleCookie('acme', t),
    scope: 'path',
    httpOnly: true,
    sameSite: 'Lax',
    path: '/tenants/acme/',
  },
  host('console login', (t) => loginCookie('state', t)),
  host('console login, cleared', (t) => clearedLoginCookie(t)),
  host('console restart', (t) => restartCookie(t)),
  host('console restart, cleared', (t) => clearedRestartCookie(t)),
  host('console session', (t) => sessionCookie('value', t), 'Strict'),
  host('console session, cleared', (t) => clearedSessionCookie(t), 'Strict'),
  {
    name: 'theme choice',
    write: (t) => themeCookie('dark', t),
    scope: 'none',
    httpOnly: false,
    sameSite: 'Lax',
    path: '/',
  },
];

function attributes(cookie: string): string[] {
  return cookie.split('; ').slice(1);
}

describe.each(WRITERS)('$name', (writer) => {
  it.each([true, false])('with tls=%s has the name, scope and attributes it should', (tls) => {
    const cookie = writer.write(tls);
    const name = cookie.slice(0, cookie.indexOf('='));
    const attrs = attributes(cookie);

    if (tls && writer.scope === 'host') expect(name.startsWith('__Host-')).toBe(true);
    if (tls && writer.scope === 'path') expect(name.startsWith('__Secure-')).toBe(true);
    if (!tls || writer.scope === 'none') expect(name).not.toMatch(/^__/u);
    expect(attrs.includes('Secure')).toBe(tls);
    expect(attrs.includes('HttpOnly')).toBe(writer.httpOnly);
    expect(attrs).toContain(`SameSite=${writer.sameSite}`);
    expect(attrs).toContain(`Path=${writer.path}`);
    expect(attrs.some((attribute) => /^Domain=/iu.test(attribute))).toBe(false);
    // A __Host- cookie is refused unless Secure, Path=/ and no Domain.
    if (name.startsWith('__Host-')) {
      expect(attrs).toContain('Secure');
      expect(attrs).toContain('Path=/');
    }
  });
});

// A writer added to a module the table imports from, and not to the table,
// fails here rather than going unchecked.
it('lists every cookie writer the console and sign-in modules export', async () => {
  const consoleWriters = Object.keys(
    await import('../../packages/console-gateway/src/service/cookies.js'),
  ).filter((name) => name.endsWith('Cookie') && name !== 'readCookie');
  const signInWriters = Object.keys(
    await import('../../packages/authn-flows/src/service/sign-in-handle.js'),
  ).filter((name) => name.endsWith('Cookie'));
  const sessionWriters = Object.keys(
    await import('../../packages/authn-flows/src/service/session-cookie.js'),
  ).filter((name) => name.endsWith('Cookies'));
  expect(consoleWriters).toHaveLength(6);
  expect(signInWriters).toHaveLength(2);
  expect(sessionWriters).toHaveLength(2);
  expect(WRITERS.filter((writer) => writer.name.startsWith('console'))).toHaveLength(6);
  expect(WRITERS.filter((writer) => writer.name.startsWith('sign-in'))).toHaveLength(2);
  expect(WRITERS.filter((writer) => writer.name.startsWith('SSO'))).toHaveLength(4);
});
