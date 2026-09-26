import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookies,
  readSessionEntries,
  sessionCookieName,
  sessionCookies,
  type SessionEntries,
} from '#/service/session-cookie';
import { SessionEntry } from '#/service/session-entry';

describe('session cookie naming', () => {
  it('uses the __Host- prefix when TLS is on', () => {
    expect(sessionCookieName('acme', true)).toBe('__Host-acme-session');
  });

  it('drops the prefix without TLS, because browsers reject __Host- without Secure', () => {
    expect(sessionCookieName('acme', false)).toBe('acme-session');
  });
});

const A = SessionEntry.issue('0192f2a0-0000-7000-8000-000000000001');
const B = SessionEntry.issue('0192f2a0-0000-7000-8000-000000000002');
const a = A.cookieValue();
const b = B.cookieValue();

function values(read: SessionEntries): { ephemeral: string[]; persistent: string[] } {
  return {
    ephemeral: read.ephemeral.map((entry) => entry.cookieValue()),
    persistent: read.persistent.map((entry) => entry.cookieValue()),
  };
}

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
      `__Host-demo-session=${a}; HttpOnly; SameSite=Lax; Path=/; Secure`,
      `__Host-demo-session-persistent=${b}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000`,
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

    expect(written[0]).toBe(`demo-session=${a}; HttpOnly; SameSite=Lax; Path=/`);
  });

  it('joins several entries with a separator neither half of an entry can contain', () => {
    const written = sessionCookies({
      tenant: 'demo',
      tls: false,
      ephemeral: [A, B],
      persistent: [],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written[0]).toBe(`demo-session=${a}.${b}; HttpOnly; SameSite=Lax; Path=/`);
    expect(values(readSessionEntries(`demo-session=${a}.${b}`, 'demo', false)).ephemeral).toEqual([
      a,
      b,
    ]);
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

describe('readSessionEntries', () => {
  it('reads both lists and keeps them apart', () => {
    const header = `__Host-demo-session=${a}; __Host-demo-session-persistent=${b}`;
    expect(values(readSessionEntries(header, 'demo', true))).toEqual({
      ephemeral: [a],
      persistent: [b],
    });
  });

  it('is empty for an absent header', () => {
    expect(values(readSessionEntries(undefined, 'demo', true))).toEqual({
      ephemeral: [],
      persistent: [],
    });
  });

  it('drops a value that is not an entry rather than failing the request', () => {
    const header = `__Host-demo-session=${a}.not-a-uuid.`;
    expect(values(readSessionEntries(header, 'demo', true))).toEqual({
      ephemeral: [a],
      persistent: [],
    });
  });

  it('drops a bare session id, which is the public sid and proves nothing', () => {
    const header = `__Host-demo-session=${A.id}.${a}`;
    expect(values(readSessionEntries(header, 'demo', true))).toEqual({
      ephemeral: [a],
      persistent: [],
    });
  });

  it('ignores another tenant’s cookie in the same jar', () => {
    const header = `__Host-other-session=${b}; __Host-demo-session=${a}`;
    expect(values(readSessionEntries(header, 'demo', true))).toEqual({
      ephemeral: [a],
      persistent: [],
    });
  });

  it('accepts an uppercase UUID, the way @odudu/kernel’s isUuid does', () => {
    const upper = `${A.id.toUpperCase()}${a.slice(A.id.length)}`;
    const header = `__Host-demo-session=${upper}`;
    expect(values(readSessionEntries(header, 'demo', true))).toEqual({
      ephemeral: [upper],
      persistent: [],
    });
  });
});

describe('clearedSessionCookies', () => {
  it('expires both names', () => {
    const cleared = clearedSessionCookies('demo', true);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});
