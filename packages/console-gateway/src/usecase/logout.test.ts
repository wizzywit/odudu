import { type DatabaseHandle } from '@odudu/db';
import type * as OduduDb from '@odudu/db';
import { describe, expect, it, vi } from 'vitest';
import { type ConsoleSessionRecord } from '#/repository/console-sessions';
import { type Caller, type OduduPort } from '#/service/odudu-port';
import { logout, type LogoutDeps } from '#/usecase/logout';

const takeSession = vi.fn();
const nameOf = vi.fn();

vi.mock('@odudu/db', async (importOriginal) => ({
  ...(await importOriginal<typeof OduduDb>()),
  withTenant: <T>(_db: unknown, _tenantId: string, fn: (tx: unknown) => Promise<T>) => fn({}),
}));

vi.mock('#/repository/console-sessions', () => ({
  consoleSessionRepository: () => ({ take: takeSession }),
}));

vi.mock('#/repository/tenants', () => ({
  tenantNameRepository: () => ({ nameOf }),
}));

vi.mock('@odudu/crypto', () => ({ unwrapSecret: () => 'plain' }));

const session: ConsoleSessionRecord = {
  id: 's1',
  tenantId: 't1',
  subjectId: 'u1',
  secretHash: Buffer.alloc(0),
  accessTokenWrapped: 'wrapped',
  refreshTokenWrapped: 'wrapped',
  idTokenWrapped: 'wrapped',
  accessExpiresAt: new Date(),
  createdAt: new Date(),
  lastSeenAt: new Date(),
  expiresAt: new Date(),
};

vi.mock('#/usecase/resolve-session', () => ({
  resolveSession: () => Promise.resolve({ kind: 'ok', session }),
}));

const FROM: Caller = { ip: '127.0.0.1', requestId: 'r1' };
const DATABASE = { db: {} } as unknown as DatabaseHandle;

function fakePort(overrides: Partial<OduduPort> = {}): OduduPort {
  return {
    issuerOf: () => Promise.resolve(null),
    discoveryOf: () => Promise.resolve(null),
    keysOf: () => Promise.resolve(null),
    exchangeCode: () => Promise.resolve(null),
    revoke: () => Promise.resolve(undefined),
    refresh: () => Promise.resolve({ kind: 'failed' }),
    forward: () => Promise.resolve({ status: 200, headers: {}, body: Buffer.alloc(0) }),
    ...overrides,
  };
}

describe('logout', () => {
  it('falls back to the console redirect when the issuer is not a URL', async () => {
    takeSession.mockResolvedValueOnce(session);
    nameOf.mockResolvedValueOnce('acme');
    const odudu = fakePort({ issuerOf: () => Promise.resolve('not a url') });
    const deps: LogoutDeps = {
      database: DATABASE,
      kek: new Uint8Array(32),
      odudu,
      tls: true,
      base: new URL('https://console.example'),
    };

    const result = await logout(deps, {
      cookieHeader: 'odudu-console=x',
      from: FROM,
      now: new Date(),
    });

    expect(result).toEqual({ kind: 'redirect', redirect: '/console/' });
    expect(takeSession).toHaveBeenCalledWith(session.id);
  });
});
