import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withSavepoint,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleLoginRepository, type ConsoleLoginRecord } from '#/repository/console-logins';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let app: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const MINUTE = 60_000;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenantAndSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const subjectId = newId();
  await tx.execute(sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${`t-${tenantId}`})`);
  await tx.execute(
    sql`INSERT INTO subjects (id, tenant_id, type) VALUES (${subjectId}, ${tenantId}, 'user')`,
  );
  return subjectId;
}

async function seedSession(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ConsoleSessionRecord> {
  const subjectId = await seedTenantAndSubject(tx, tenantId);
  return consoleSessionRepository(tx).create({
    tenantId,
    subjectId,
    secretHash: randomBytes(32),
    tokens: {
      accessTokenWrapped: 'access-wrapped',
      refreshTokenWrapped: 'refresh-wrapped',
      accessExpiresAt: new Date(NOW.getTime() + 5 * MINUTE),
    },
    idTokenWrapped: 'id-wrapped',
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 12 * 60 * MINUTE),
  });
}

async function seedLogin(tx: TenantScopedDatabase, tenantId: string): Promise<ConsoleLoginRecord> {
  await seedTenantAndSubject(tx, tenantId);
  return consoleLoginRepository(tx).create({
    tenantId,
    stateHash: randomBytes(32),
    verifierWrapped: 'verifier-wrapped',
    nonce: 'nonce',
    returnTo: '/console/',
    expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
  });
}

// A refused insert aborts the transaction it ran in, so it runs in a
// savepoint of its own and answers the error rather than throwing it.
async function refusal(
  tx: TenantScopedDatabase,
  fn: (inner: TenantScopedDatabase) => Promise<unknown>,
): Promise<unknown> {
  return withSavepoint(tx, fn).then(
    () => null,
    (error: unknown) => error,
  );
}

function expectRowLevelSecurityRefusal(result: unknown): void {
  expect(result).toBeInstanceOf(Error);
  expect(String((result as Error).cause)).toMatch(/row-level security/u);
}

async function expectRefusedBy(attempt: Promise<unknown>, constraint: string): Promise<void> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String((error as Error).cause)).toContain(constraint);
}

async function sessionById(
  tx: TenantScopedDatabase,
  session: ConsoleSessionRecord,
): Promise<ConsoleSessionRecord | null> {
  return consoleSessionRepository(tx).bySecretHash(session.secretHash);
}

async function expectSessionUnchanged(
  tx: TenantScopedDatabase,
  seeded: ConsoleSessionRecord,
): Promise<void> {
  expect(await sessionById(tx, seeded)).toEqual(seeded);
}

describe('consoleSessionRepository', () => {
  it('finds a created session by its secret hash', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    const found = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).bySecretHash(created.secretHash),
    );

    expect(found).toEqual(created);
    expect(found?.lastSeenAt).toEqual(NOW);
    expect(found?.createdAt).toEqual(NOW);
  });

  it('locks a session by id, and answers null for an unknown one', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    const locked = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).lockById(created.id),
    );
    const unknown = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).lockById(newId()),
    );

    expect(locked).toEqual(created);
    expect(unknown).toBeNull();
  });

  it('holds the row lock until the locking transaction ends', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const first = withTenant(app.db, tenantId, async (tx) => {
      await consoleSessionRepository(tx).lockById(created.id);
      locked();
      await held;
      order.push('first released');
    });
    await lockTaken;
    const second = withTenant(app.db, tenantId, async (tx) => {
      await consoleSessionRepository(tx).lockById(created.id);
      order.push('second locked');
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first released', 'second locked']);
  });

  it('touches last_seen_at', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));
    const later = new Date(NOW.getTime() + 3 * MINUTE);

    const touched = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).touch(created.id, later),
    );
    const found = await withTenant(app.db, tenantId, (tx) => sessionById(tx, created));

    expect(touched).toBe('touched');
    expect(found?.lastSeenAt).toEqual(later);
  });

  it('skips a touch while the row is locked, without waiting, and says so', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = withTenant(app.db, tenantId, async (tx) => {
      await consoleSessionRepository(tx).lockById(created.id);
      locked();
      await held;
    });
    await isLocked;

    const touched = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).touch(created.id, new Date(NOW.getTime() + 3 * MINUTE)),
    );
    release();
    await holder;
    const found = await withTenant(app.db, tenantId, (tx) => sessionById(tx, created));

    expect(touched).toBe('locked');
    expect(found?.lastSeenAt).toEqual(NOW);
  });

  it('reports a touch of a row that does not exist as gone', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    const touched = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).touch(newId(), NOW),
    );

    expect(touched).toBe('gone');
  });

  it('replaces the access and refresh tokens and keeps the ID token', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));
    const tokens = {
      accessTokenWrapped: 'access-2',
      refreshTokenWrapped: 'refresh-2',
      accessExpiresAt: new Date(NOW.getTime() + 10 * MINUTE),
    };

    const replaced = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).replaceTokens(created.id, tokens),
    );
    const found = await withTenant(app.db, tenantId, (tx) => sessionById(tx, created));

    expect(replaced).toBe(true);
    expect(found).toEqual({ ...created, ...tokens });
  });

  it('deletes a session', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    const deleted = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).delete(created.id),
    );
    const again = await withTenant(app.db, tenantId, (tx) =>
      consoleSessionRepository(tx).delete(created.id),
    );

    expect(deleted).toBe(true);
    expect(again).toBe(false);
    expect(await withTenant(app.db, tenantId, (tx) => sessionById(tx, created))).toBeNull();
  });

  it('refuses a session hash already taken', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    await expect(
      withTenant(app.db, tenantId, (tx) =>
        consoleSessionRepository(tx).create({
          tenantId,
          subjectId: created.subjectId,
          secretHash: created.secretHash,
          tokens: {
            accessTokenWrapped: 'a',
            refreshTokenWrapped: 'r',
            accessExpiresAt: NOW,
          },
          idTokenWrapped: 'i',
          now: NOW,
          expiresAt: NOW,
        }),
      ),
    ).rejects.toThrow();
  });
  it('refuses a secret hash that is not a SHA-256 digest', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedSession(tx, tenantId));

    await expectRefusedBy(
      withTenant(app.db, tenantId, (tx) =>
        consoleSessionRepository(tx).create({
          tenantId,
          subjectId: created.subjectId,
          secretHash: randomBytes(31),
          tokens: { accessTokenWrapped: 'a', refreshTokenWrapped: 'r', accessExpiresAt: NOW },
          idTokenWrapped: 'i',
          now: NOW,
          expiresAt: NOW,
        }),
      ),
      'console_sessions_secret_hash_length',
    );
  });
});

describe('consoleSessionRepository under a foreign tenant', () => {
  it('create refuses a row carrying another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedTenantAndSubject(tx, tenantId);
        return { tenantId, subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const rows = await tx.execute(sql`SELECT id FROM subjects WHERE id = ${seeded.subjectId}`);
        expect(rows).toHaveLength(1);
      },
      attempt: async (tx, seeded) =>
        refusal(tx, (inner) =>
          consoleSessionRepository(inner).create({
            tenantId: seeded.tenantId,
            subjectId: seeded.subjectId,
            secretHash: randomBytes(32),
            tokens: { accessTokenWrapped: 'a', refreshTokenWrapped: 'r', accessExpiresAt: NOW },
            idTokenWrapped: 'i',
            now: NOW,
            expiresAt: NOW,
          }),
        ),
      expectBlocked: expectRowLevelSecurityRefusal,
      verifyTenantAUnaffected: async (tx) => {
        expect(await tx.execute(sql`SELECT id FROM console_sessions`)).toHaveLength(0);
      },
    });
  });

  it('bySecretHash finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedSession,
      verifySeeded: async (tx, seeded) => {
        expect(await sessionById(tx, seeded)).toEqual(seeded);
      },
      attempt: (tx, seeded) => consoleSessionRepository(tx).bySecretHash(seeded.secretHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('lockById finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedSession,
      verifySeeded: async (tx, seeded) => {
        expect(await consoleSessionRepository(tx).lockById(seeded.id)).toEqual(seeded);
      },
      attempt: (tx, seeded) => consoleSessionRepository(tx).lockById(seeded.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('touch changes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedSession,
      verifySeeded: expectSessionUnchanged,
      attempt: (tx, seeded) =>
        consoleSessionRepository(tx).touch(seeded.id, new Date(NOW.getTime() + MINUTE)),
      expectBlocked: (result) => {
        expect(result).toBe('gone');
      },
      verifyTenantAUnaffected: expectSessionUnchanged,
    });
  });

  it('replaceTokens changes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedSession,
      verifySeeded: expectSessionUnchanged,
      attempt: (tx, seeded) =>
        consoleSessionRepository(tx).replaceTokens(seeded.id, {
          accessTokenWrapped: 'stolen',
          refreshTokenWrapped: 'stolen',
          accessExpiresAt: NOW,
        }),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: expectSessionUnchanged,
    });
  });

  it('delete removes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedSession,
      verifySeeded: expectSessionUnchanged,
      attempt: (tx, seeded) => consoleSessionRepository(tx).delete(seeded.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: expectSessionUnchanged,
    });
  });
});

describe('consoleLoginRepository', () => {
  it('takes a pending login once, then answers null', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedLogin(tx, tenantId));

    const first = await withTenant(app.db, tenantId, (tx) =>
      consoleLoginRepository(tx).takeByStateHash(created.stateHash, NOW),
    );
    const second = await withTenant(app.db, tenantId, (tx) =>
      consoleLoginRepository(tx).takeByStateHash(created.stateHash, NOW),
    );

    expect(first).toEqual(created);
    expect(second).toBeNull();
  });

  it('gives a login to exactly one of two callbacks racing for it', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedLogin(tx, tenantId));

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let taken: () => void = () => undefined;
    const firstTook = new Promise<void>((resolve) => {
      taken = resolve;
    });

    const first = withTenant(app.db, tenantId, async (tx) => {
      const login = await consoleLoginRepository(tx).takeByStateHash(created.stateHash, NOW);
      taken();
      await held;
      return login;
    });
    await firstTook;
    const second = withTenant(app.db, tenantId, (tx) =>
      consoleLoginRepository(tx).takeByStateHash(created.stateHash, NOW),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const results = await Promise.all([first, second]);

    expect(results.filter((login) => login !== null)).toEqual([created]);
  });

  it('does not return an expired login', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedLogin(tx, tenantId));

    const taken = await withTenant(app.db, tenantId, (tx) =>
      consoleLoginRepository(tx).takeByStateHash(
        created.stateHash,
        new Date(created.expiresAt.getTime() + 1000),
      ),
    );

    expect(taken).toBeNull();
  });

  it('refuses a state hash already taken', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedLogin(tx, tenantId));

    await expect(
      withTenant(app.db, tenantId, (tx) =>
        consoleLoginRepository(tx).create({ ...created, nonce: 'other' }),
      ),
    ).rejects.toThrow();
  });
  it('refuses a state hash that is not a SHA-256 digest', async () => {
    const tenantId = newId();
    const created = await withTenant(app.db, tenantId, (tx) => seedLogin(tx, tenantId));

    await expectRefusedBy(
      withTenant(app.db, tenantId, (tx) =>
        consoleLoginRepository(tx).create({ ...created, stateHash: randomBytes(33) }),
      ),
      'console_logins_state_hash_length',
    );
  });
});

describe('consoleLoginRepository under a foreign tenant', () => {
  it('create refuses a row carrying another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenantAndSubject(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        const rows = await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId}`);
        expect(rows).toHaveLength(1);
      },
      attempt: async (tx, tenantId) =>
        refusal(tx, (inner) =>
          consoleLoginRepository(inner).create({
            tenantId,
            stateHash: randomBytes(32),
            verifierWrapped: 'v',
            nonce: 'n',
            returnTo: '/console/',
            expiresAt: NOW,
          }),
        ),
      expectBlocked: expectRowLevelSecurityRefusal,
      verifyTenantAUnaffected: async (tx) => {
        expect(await tx.execute(sql`SELECT id FROM console_logins`)).toHaveLength(0);
      },
    });
  });

  it('takeByStateHash takes nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedLogin,
      verifySeeded: async (tx, seeded) => {
        const rows = await tx.execute(sql`SELECT id FROM console_logins WHERE id = ${seeded.id}`);
        expect(rows).toHaveLength(1);
      },
      attempt: (tx, seeded) => consoleLoginRepository(tx).takeByStateHash(seeded.stateHash, NOW),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(await consoleLoginRepository(tx).takeByStateHash(seeded.stateHash, NOW)).toEqual(
          seeded,
        );
      },
    });
  });
});
