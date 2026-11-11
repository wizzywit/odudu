import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialRepository } from '#/repository/credentials';
import { subjectRepository } from '#/repository/subjects';

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

async function seedSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
}

async function holdEveryKind(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<void> {
  const credentials = credentialRepository(tx);
  await credentials.insert({
    tenantId,
    subjectId,
    type: 'password',
    secret: { kind: 'password', hash: 'phc-hash' },
  });
  await credentials.insert({
    tenantId,
    subjectId,
    type: 'password-history',
    secret: { kind: 'password-history', hash: 'old-hash' },
  });
  await credentials.insert({
    tenantId,
    subjectId,
    type: 'totp',
    secret: { kind: 'totp', secret: 'seed-material', digits: 6, lastStep: 0 },
    label: 'Phone',
  });
  await credentials.insert({
    tenantId,
    subjectId,
    type: 'webauthn',
    secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: [] },
    label: 'Laptop key',
    lookupKey: `lk-${newId()}`,
  });
  await credentials.insert({
    tenantId,
    subjectId,
    type: 'recovery-code',
    secret: { kind: 'recovery-code', hash: 'code-hash' },
  });
}

describe('credentialRepository.summariesFor', () => {
  it('lists the ways to sign in, without recovery codes or retired passwords', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      await holdEveryKind(tx, tenantId, id);
      return id;
    });

    const rows = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 50 }),
    );

    expect(rows.map((row) => row.type).sort()).toEqual(['password', 'totp', 'webauthn']);
    const totp = rows.find((row) => row.type === 'totp');
    expect(totp?.label).toBe('Phone');
    expect(totp?.lastUsedAt).toBeNull();
    expect(totp?.createdAt).toBeInstanceOf(Date);
  });

  it('carries no member that could hold the stored secret', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      await holdEveryKind(tx, tenantId, id);
      return id;
    });

    const rows = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 50 }),
    );

    expect(JSON.stringify(rows)).not.toMatch(/seed-material|phc-hash|secret|lookup/iu);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'label', 'lastUsedAt', 'type']);
    }
  });

  it('pages in id order and stops at the limit', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      await holdEveryKind(tx, tenantId, id);
      return id;
    });

    const first = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 2 }),
    );
    const last = first[first.length - 1];
    if (last === undefined) throw new Error('expected a first page');
    const second = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: last.id, limit: 2 }),
    );

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    const ids = [...first, ...second].map((row) => row.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('lists nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedSubject(tx, tenantId);
        await holdEveryKind(tx, tenantId, subjectId);
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const rows = await credentialRepository(tx).summariesFor(seeded.subjectId, {
          after: undefined,
          limit: 50,
        });
        expect(rows).toHaveLength(3);
      },
      attempt: (tx, seeded) =>
        credentialRepository(tx).summariesFor(seeded.subjectId, { after: undefined, limit: 50 }),
      expectBlocked: (rows) => {
        expect(rows).toEqual([]);
      },
    });
  });
});

describe('credentialRepository.renameLabel', () => {
  async function seedKinds() {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      await holdEveryKind(tx, tenantId, id);
      return id;
    });
    const rows = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 50 }),
    );
    const idOf = (type: string) => rows.find((row) => row.type === type)?.id ?? '';
    return { tenantId, subjectId, idOf };
  }

  it('renames an authenticator and answers its summary', async () => {
    const { tenantId, subjectId, idOf } = await seedKinds();
    const renamed = await withTenant(app.db, tenantId, async (tx) => [
      await credentialRepository(tx).renameLabel(subjectId, idOf('totp'), 'Work phone'),
      await credentialRepository(tx).renameLabel(subjectId, idOf('webauthn'), 'Desk key'),
    ]);
    expect(renamed.map((row) => [row?.type, row?.label])).toEqual([
      ['totp', 'Work phone'],
      ['webauthn', 'Desk key'],
    ]);
    const after = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 50 }),
    );
    expect(after.find((row) => row.type === 'password')?.label).toBeNull();
  });

  it('renames neither a password nor another subject’s credential', async () => {
    const { tenantId, subjectId, idOf } = await seedKinds();
    const strangerId = await withTenant(app.db, tenantId, async (tx) => {
      const other = (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
      return other;
    });
    const answers = await withTenant(app.db, tenantId, async (tx) => [
      await credentialRepository(tx).renameLabel(subjectId, idOf('password'), 'x'),
      await credentialRepository(tx).renameLabel(strangerId, idOf('totp'), 'x'),
      await credentialRepository(tx).renameLabel(subjectId, newId(), 'x'),
    ]);
    expect(answers).toEqual([null, null, null]);
    const totp = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit: 50 }),
    );
    expect(totp.find((row) => row.type === 'totp')?.label).toBe('Phone');
  });

  it('renames nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedSubject(tx, tenantId);
        await holdEveryKind(tx, tenantId, subjectId);
        const rows = await credentialRepository(tx).summariesFor(subjectId, {
          after: undefined,
          limit: 50,
        });
        return { subjectId, credentialId: rows.find((row) => row.type === 'totp')?.id ?? '' };
      },
      verifySeeded: async (tx, seeded) => {
        const rows = await credentialRepository(tx).summariesFor(seeded.subjectId, {
          after: undefined,
          limit: 50,
        });
        expect(rows.find((row) => row.id === seeded.credentialId)?.label).toBe('Phone');
      },
      attempt: (tx, seeded) =>
        credentialRepository(tx).renameLabel(seeded.subjectId, seeded.credentialId, 'Taken'),
      expectBlocked: (renamed) => {
        expect(renamed).toBeNull();
      },
    });
  });
});
