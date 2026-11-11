import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pendingEmailRepository } from '#/repository/pending-emails';
import { subjectRepository } from '#/repository/subjects';
import { userRepository } from '#/repository/users';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function seedUser(tx: TenantScopedDatabase, tenantId: string, email: string) {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId,
    username: 'ada',
    email,
  });
  return subject.id;
}

async function inTenant<Result>(
  tenantId: string,
  run: (tx: TenantScopedDatabase) => Promise<Result>,
): Promise<Result> {
  return withTenant(app.db, tenantId, run);
}

describe('pendingEmailRepository', () => {
  it('keeps one address per subject, the latest', async () => {
    const tenantId = newId();
    const subjectId = await inTenant(tenantId, (tx) => seedUser(tx, tenantId, 'ada@example.com'));
    await inTenant(tenantId, async (tx) => {
      const pending = pendingEmailRepository(tx);
      await pending.set(tenantId, subjectId, 'first@example.com');
      await pending.set(tenantId, subjectId, 'second@example.com');
      expect(await pending.forSubject(subjectId)).toBe('second@example.com');
    });
    const rows =
      await owner.sql`select count(*)::int as n from pending_email_changes where subject_id = ${subjectId}`;
    expect(rows[0]?.n).toBe(1);
  });

  it('takes a row only while it still names the address, and only once', async () => {
    const tenantId = newId();
    const subjectId = await inTenant(tenantId, (tx) => seedUser(tx, tenantId, 'ada@example.com'));
    await inTenant(tenantId, async (tx) => {
      const pending = pendingEmailRepository(tx);
      await pending.set(tenantId, subjectId, 'new@example.com');
      expect(await pending.take(subjectId, 'other@example.com')).toBe(false);
      expect(await pending.take(subjectId, 'new@example.com')).toBe(true);
      expect(await pending.take(subjectId, 'new@example.com')).toBe(false);
      expect(await pending.forSubject(subjectId)).toBeNull();
    });
  });

  it('forgets the pending address, and a second time is no error', async () => {
    const tenantId = newId();
    const subjectId = await inTenant(tenantId, (tx) => seedUser(tx, tenantId, 'ada@example.com'));
    await inTenant(tenantId, async (tx) => {
      const pending = pendingEmailRepository(tx);
      await pending.set(tenantId, subjectId, 'new@example.com');
      await pending.clear(subjectId);
      await pending.clear(subjectId);
      expect(await pending.forSubject(subjectId)).toBeNull();
    });
  });

  it('forgets nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedUser(tx, tenantId, 'ada@example.com');
        await pendingEmailRepository(tx).set(tenantId, subjectId, 'new@example.com');
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await pendingEmailRepository(tx).forSubject(seeded.subjectId)).not.toBeNull();
      },
      attempt: (tx, seeded) => pendingEmailRepository(tx).clear(seeded.subjectId),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(await pendingEmailRepository(tx).forSubject(seeded.subjectId)).toBe(
          'new@example.com',
        );
      },
    });
  });

  it('goes with the subject', async () => {
    const tenantId = newId();
    const subjectId = await inTenant(tenantId, (tx) => seedUser(tx, tenantId, 'ada@example.com'));
    await inTenant(tenantId, (tx) =>
      pendingEmailRepository(tx).set(tenantId, subjectId, 'new@example.com'),
    );
    await owner.sql`delete from subjects where id = ${subjectId}`;
    const rows =
      await owner.sql`select 1 from pending_email_changes where subject_id = ${subjectId}`;
    expect(rows).toHaveLength(0);
  });

  const seedPending = async (tx: TenantScopedDatabase, tenantId: string) => {
    const subjectId = await seedUser(tx, tenantId, 'ada@example.com');
    await pendingEmailRepository(tx).set(tenantId, subjectId, 'new@example.com');
    return { subjectId };
  };

  it('reads nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedPending,
      verifySeeded: async (tx, seeded) => {
        expect(await pendingEmailRepository(tx).forSubject(seeded.subjectId)).toBe(
          'new@example.com',
        );
      },
      attempt: (tx, seeded) => pendingEmailRepository(tx).forSubject(seeded.subjectId),
      expectBlocked: (found) => {
        expect(found).toBeNull();
      },
    });
  });

  it('takes nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedPending,
      verifySeeded: async (tx, seeded) => {
        expect(await pendingEmailRepository(tx).forSubject(seeded.subjectId)).not.toBeNull();
      },
      attempt: (tx, seeded) => pendingEmailRepository(tx).take(seeded.subjectId, 'new@example.com'),
      expectBlocked: (taken) => {
        expect(taken).toBe(false);
      },
    });
  });

  it('refuses a row written under another tenant’s id', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const subjectId = await inTenant(tenantA, (tx) => seedUser(tx, tenantA, 'ada@example.com'));
    await expect(
      inTenant(tenantB, (tx) =>
        pendingEmailRepository(tx).set(tenantA, subjectId, 'intruder@example.com'),
      ),
    ).rejects.toThrow(/pending_email_changes/u);
    expect(await inTenant(tenantA, (tx) => pendingEmailRepository(tx).forSubject(subjectId))).toBe(
      null,
    );
  });
});

describe('userRepository.replaceVerifiedEmail', () => {
  it('sets the address and marks it verified', async () => {
    const tenantId = newId();
    const subjectId = await inTenant(tenantId, (tx) => seedUser(tx, tenantId, 'ada@example.com'));
    const user = await inTenant(tenantId, (tx) =>
      userRepository(tx).replaceVerifiedEmail(subjectId, 'new@example.com'),
    );
    expect(user).toMatchObject({ email: 'new@example.com', emailVerified: true });
  });

  it('changes nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => ({
        subjectId: await seedUser(tx, tenantId, 'ada@example.com'),
      }),
      verifySeeded: async (tx, seeded) => {
        expect((await userRepository(tx).bySubjectId(seeded.subjectId))?.email).toBe(
          'ada@example.com',
        );
      },
      attempt: (tx, seeded) =>
        userRepository(tx)
          .replaceVerifiedEmail(seeded.subjectId, 'new@example.com')
          .then(
            () => 'written',
            () => 'refused',
          ),
      expectBlocked: (outcome) => {
        expect(outcome).toBe('refused');
      },
    });
  });
});
