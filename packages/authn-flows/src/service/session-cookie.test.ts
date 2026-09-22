import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookies,
  readSessionIds,
  sessionCookieName,
  sessionCookies,
} from '#/service/session-cookie';

describe('session cookie naming', () => {
  it('uses the __Host- prefix when TLS is on', () => {
    expect(sessionCookieName('acme', true)).toBe('__Host-acme-session');
  });

  it('drops the prefix without TLS, because browsers reject __Host- without Secure', () => {
    expect(sessionCookieName('acme', false)).toBe('acme-session');
  });
});

const A = '0192f2a0-0000-7000-8000-000000000001';
const B = '0192f2a0-0000-7000-8000-000000000002';

describe('sessionCookies', () => {
  it('writes the ephemeral list with no Max-Age and the persistent list with one', () => {
    const written = sessionCookies({
      tenant: 'demo',
      tls: true,
      ephemeral: [A],
      persistent: [B],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written).toEqual([
      `__Host-demo-session=${A}; HttpOnly; SameSite=Lax; Path=/; Secure`,
      `__Host-demo-session-persistent=${B}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000`,
    ]);
  });

  it('drops Secure and the prefix together when TLS is off, and nothing else', () => {
    const written = sessionCookies({
      tenant: 'demo',
      tls: false,
      ephemeral: [A],
      persistent: [],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written[0]).toBe(`demo-session=${A}; HttpOnly; SameSite=Lax; Path=/`);
  });

  it('expires a list that has become empty rather than leaving it in the browser', () => {
    const written = sessionCookies({
      tenant: 'demo',
      tls: true,
      ephemeral: [],
      persistent: [B],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written[0]).toContain('Max-Age=0');
  });
});

describe('readSessionIds', () => {
  it('reads both lists and keeps them apart', () => {
    const header = `__Host-demo-session=${A}; __Host-demo-session-persistent=${B}`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [B] });
  });

  it('is empty for an absent header', () => {
    expect(readSessionIds(undefined, 'demo', true)).toEqual({ ephemeral: [], persistent: [] });
  });

  it('drops a value that is not a session id rather than failing the request', () => {
    const header = `__Host-demo-session=${A}.not-a-uuid.`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [] });
  });

  it('ignores another tenant’s cookie in the same jar', () => {
    const header = `__Host-other-session=${B}; __Host-demo-session=${A}`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [] });
  });
});

describe('clearedSessionCookies', () => {
  it('expires both names', () => {
    const cleared = clearedSessionCookies('demo', true);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});
