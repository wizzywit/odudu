import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { newId, pathAddress } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { signInHandleCookie } from '#/service/sign-in-handle';
import { consumeAuthenticationSession, heldSignIn, startAuthentication } from '#/usecase/executor';

let container: TestDatabase | undefined;
let owner: DatabaseHandle | undefined;
let app: DatabaseHandle | undefined;

const request: PendingRequest = {
  clientId: 'console',
  redirectUri: 'https://console.example/callback',
  scope: 'openid',
  state: 'the-apps-own-state',
  nonce: 'the-apps-own-nonce',
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await container?.stop();
});

function database(): DatabaseHandle {
  if (app === undefined) throw new Error('the database is not up');
  return app;
}

async function tenantWith(name: string): Promise<string> {
  const id = newId();
  await withTenant(database().db, id, (tx: TenantScopedDatabase) =>
    tx.insert(tenants).values({ id, name }),
  );
  return id;
}

// The Cookie header a browser holding the session's handle would send.
function header(tenant: string, sessionId: string, secret: string): string {
  const [pair = ''] = signInHandleCookie(
    pathAddress('https://idp.example', tenant),
    false,
    sessionId,
    secret,
    60,
  ).split(';');
  return `theme=light; ${pair}`;
}

async function park(tenantId: string) {
  return withTenant(database().db, tenantId, (tx) => startAuthentication(tx, tenantId, request));
}

async function held(tenantId: string, cookie: string | undefined, at?: Date) {
  return withTenant(database().db, tenantId, (tx) =>
    heldSignIn(tx, cookie, false, at === undefined ? undefined : { now: () => at }),
  );
}

describe('a parked sign-in and the browser that parked it', () => {
  it('hands the browser a secret and keeps only its hash', async () => {
    const tenantId = await tenantWith('bind-hash');
    const { authSessionId, browser } = await park(tenantId);
    expect(browser.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(browser.maxAgeSeconds).toBe(1800);

    const record = await withTenant(database().db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.browserSecretHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(record?.browserSecretHash).not.toContain(browser.secret);
  });

  it('is held by the browser that presents its own secret, with the original request', async () => {
    const tenantId = await tenantWith('bind-held');
    const { authSessionId, browser } = await park(tenantId);

    expect(await held(tenantId, header('bind-held', authSessionId, browser.secret))).toEqual({
      sessionId: authSessionId,
      pendingRequest: request,
    });
  });

  it('is not held without a cookie, or with a secret that is not its own', async () => {
    const tenantId = await tenantWith('bind-other');
    const { authSessionId } = await park(tenantId);
    const other = await park(tenantId);

    expect(await held(tenantId, undefined)).toBeNull();
    expect(await held(tenantId, 'theme=light')).toBeNull();
    expect(
      await held(tenantId, header('bind-other', authSessionId, other.browser.secret)),
    ).toBeNull();
    expect(await held(tenantId, header('bind-other', authSessionId, 'guess'))).toBeNull();
    expect(await held(tenantId, header('bind-other', newId(), other.browser.secret))).toBeNull();
  });

  it('is not held in another tenant, where the row cannot be seen', async () => {
    const tenantA = await tenantWith('bind-tenant-a');
    const tenantB = await tenantWith('bind-tenant-b');
    const { authSessionId, browser } = await park(tenantA);
    const cookie = header('bind-tenant-a', authSessionId, browser.secret);

    expect(await held(tenantB, cookie)).toBeNull();
    expect(await held(tenantA, cookie)).not.toBeNull();
  });

  it('is not held once it has expired, at the instant it expires or after', async () => {
    const tenantId = await tenantWith('bind-expired');
    const { authSessionId, browser } = await park(tenantId);
    const cookie = header('bind-expired', authSessionId, browser.secret);
    const record = await withTenant(database().db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    const expiresAt = record?.expiresAt ?? new Date(0);

    expect(await held(tenantId, cookie, new Date(expiresAt.getTime() - 1))).not.toBeNull();
    expect(await held(tenantId, cookie, expiresAt)).toBeNull();
    expect(await held(tenantId, cookie, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it('is not held once a sign-in has consumed it', async () => {
    const tenantId = await tenantWith('bind-consumed');
    const { authSessionId, browser } = await park(tenantId);
    const cookie = header('bind-consumed', authSessionId, browser.secret);
    expect(await held(tenantId, cookie)).not.toBeNull();

    await withTenant(database().db, tenantId, (tx) =>
      consumeAuthenticationSession(tx, authSessionId),
    );
    expect(await held(tenantId, cookie)).toBeNull();
  });

  it('is not held when the row carries no secret at all', async () => {
    const tenantId = await tenantWith('bind-legacy');
    const { authSessionId } = await park(tenantId);
    await withTenant(database().db, tenantId, (tx) =>
      tx.execute(sql`update authentication_sessions set browser_secret_hash = null`),
    );

    expect(await held(tenantId, header('bind-legacy', authSessionId, ''))).toBeNull();
    expect(await held(tenantId, header('bind-legacy', authSessionId, 'x'))).toBeNull();
  });
});
