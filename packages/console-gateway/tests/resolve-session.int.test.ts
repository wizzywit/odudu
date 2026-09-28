import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';
import { bindToTenant, randomSecret, sha256 } from '#/service/secrets';
import { resolveSession, type ResolveSessionDeps } from '#/usecase/resolve-session';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let deps: ResolveSessionDeps;

const SIGNED_IN = new Date('2026-06-01T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const COOKIE = 'odudu-console';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  deps = { database: appHandle, tls: false };
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function at(ms: number): Date {
  return new Date(SIGNED_IN.getTime() + ms);
}

interface Seeded {
  readonly session: ConsoleSessionRecord;
  readonly cookie: string;
  readonly secret: string;
}

async function seedSession(): Promise<Seeded> {
  const tenantId = newId();
  const subjectId = newId();
  const secret = randomSecret();
  await owner.db.execute(
    sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${`t-${tenantId.slice(-12)}`})`,
  );
  await owner.db.execute(
    sql`INSERT INTO subjects (id, tenant_id, type) VALUES (${subjectId}, ${tenantId}, 'user')`,
  );
  const session = await withTenant(owner.db, tenantId, (tx) =>
    consoleSessionRepository(tx).create({
      tenantId,
      subjectId,
      secretHash: sha256(secret),
      tokens: {
        accessTokenWrapped: 'access-wrapped',
        refreshTokenWrapped: 'refresh-wrapped',
        accessExpiresAt: at(5 * MINUTE),
      },
      idTokenWrapped: 'id-wrapped',
      now: SIGNED_IN,
      expiresAt: at(12 * 60 * MINUTE),
    }),
  );
  return { session, secret, cookie: `${COOKIE}=${bindToTenant(tenantId, secret)}` };
}

async function rowOf(session: ConsoleSessionRecord): Promise<ConsoleSessionRecord | null> {
  return withTenant(owner.db, session.tenantId, (tx) =>
    consoleSessionRepository(tx).bySecretHash(session.secretHash),
  );
}

describe('resolveSession', () => {
  it('answers a live session from its cookie among others', async () => {
    const { session, cookie } = await seedSession();

    const result = await resolveSession(deps, `theme=dark; ${cookie}`, at(10 * SECOND));

    expect(result).toEqual({ kind: 'ok', session });
  });

  it('writes last_seen_at at most once a minute', async () => {
    const { session, cookie } = await seedSession();

    await resolveSession(deps, cookie, at(59 * SECOND));
    expect((await rowOf(session))?.lastSeenAt).toEqual(SIGNED_IN);

    const touched = await resolveSession(deps, cookie, at(MINUTE));
    expect((await rowOf(session))?.lastSeenAt).toEqual(at(MINUTE));
    expect(touched).toEqual({ kind: 'ok', session: { ...session, lastSeenAt: at(MINUTE) } });
  });

  it('holds a session idle for thirty minutes and ends it a second later, deleting it', async () => {
    const { session, cookie } = await seedSession();

    expect((await resolveSession(deps, cookie, at(30 * MINUTE))).kind).toBe('ok');
    expect(await resolveSession(deps, cookie, at(60 * MINUTE + SECOND))).toEqual({
      kind: 'ended',
    });
    expect(await rowOf(session)).toBeNull();
  });

  it('ends a session at twelve hours however active, deleting it', async () => {
    const { session, cookie } = await seedSession();
    for (let seen = 25 * MINUTE; seen < 12 * 60 * MINUTE; seen += 25 * MINUTE) {
      expect((await resolveSession(deps, cookie, at(seen))).kind).toBe('ok');
    }
    expect((await resolveSession(deps, cookie, at(12 * 60 * MINUTE - SECOND))).kind).toBe('ok');

    expect(await resolveSession(deps, cookie, at(12 * 60 * MINUTE))).toEqual({ kind: 'ended' });
    expect(await rowOf(session)).toBeNull();
  });

  it('finds nothing through a cookie whose tenant prefix names another tenant', async () => {
    const { session, secret } = await seedSession();
    const other = await seedSession();

    const forged = `${COOKIE}=${bindToTenant(other.session.tenantId, secret)}`;

    expect(await resolveSession(deps, forged, at(SECOND))).toEqual({ kind: 'ended' });
    expect(await rowOf(session)).toEqual(session);
  });

  it.each([
    ['no cookie header', undefined],
    ['no session cookie', 'theme=dark'],
    ['an empty session cookie', `${COOKIE}=`],
    ['a value with no tenant', `${COOKIE}=justasecret`],
    ['a tenant that is not a UUID', `${COOKIE}=system.c2VjcmV0`],
    ['a value of three parts', `${COOKIE}=${newId()}.a.b`],
    ['a secret outside base64url', `${COOKIE}=${newId()}.a+b/c=`],
    ['an unknown secret', `${COOKIE}=${bindToTenant(newId(), randomSecret())}`],
  ])('ends a request with %s', async (_label, header) => {
    expect(await resolveSession(deps, header, SIGNED_IN)).toEqual({ kind: 'ended' });
  });

  it('takes neither of two session cookies, leaving both sessions alone', async () => {
    const first = await seedSession();
    const second = await seedSession();

    const result = await resolveSession(deps, `${first.cookie}; ${second.cookie}`, at(MINUTE));

    expect(result).toEqual({ kind: 'ended' });
    expect((await rowOf(first.session))?.lastSeenAt).toEqual(SIGNED_IN);
    expect((await rowOf(second.session))?.lastSeenAt).toEqual(SIGNED_IN);
  });

  it('reads the __Host- cookie under TLS and ignores the plain one', async () => {
    const { session, cookie } = await seedSession();
    const tls = { ...deps, tls: true };

    expect(await resolveSession(tls, cookie, at(SECOND))).toEqual({ kind: 'ended' });
    expect(await resolveSession(tls, `__Host-${cookie}`, at(SECOND))).toEqual({
      kind: 'ok',
      session,
    });
  });
});
