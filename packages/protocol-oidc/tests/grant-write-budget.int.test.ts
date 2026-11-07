import { subjectRepository } from '@odudu/domain-identity';
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
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { tokenGrants } from '#/schema/token-grants';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const LIMITS = { mutating: 20, creates: 10 };

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

async function seedGrant(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionTenant(tx, tenantId);
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    tenantId,
    clientId: `client-${tenantId}`,
    name: 'An agent',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  await provisionClientDefaults(tx, clientDbId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const grant = await tokenGrantRepository(tx).create({
    id: newId(),
    tenantId,
    clientId: clientDbId,
    subjectId: subject.id,
    scope: 'mcp:write',
    audience: ['https://id.example/mcp'],
  });
  return grant.id;
}

async function grantIn(): Promise<{ tenantId: string; grantId: string }> {
  const tenantId = newId();
  const grantId = await withTenant(app.db, tenantId, (tx) => seedGrant(tx, tenantId));
  return { tenantId, grantId };
}

function reserve(tenantId: string, grantId: string, kind: 'mutating' | 'create') {
  return withTenant(app.db, tenantId, (tx) =>
    tokenGrantRepository(tx).reserveAgentWrite(grantId, kind, LIMITS),
  );
}

function spent(tenantId: string, grantId: string) {
  return withTenant(app.db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ writes: tokenGrants.agentWrites, creates: tokenGrants.agentCreates })
      .from(tokenGrants)
      .where(eq(tokenGrants.id, grantId));
    return row;
  });
}

describe('the write budget of a grant', () => {
  it('starts at nothing spent', async () => {
    const { tenantId, grantId } = await grantIn();
    expect(await spent(tenantId, grantId)).toEqual({ writes: 0, creates: 0 });
  });

  it('admits twenty mutating calls and refuses the twenty-first', async () => {
    const { tenantId, grantId } = await grantIn();
    for (let i = 0; i < 20; i += 1) expect(await reserve(tenantId, grantId, 'mutating')).toBe(true);
    expect(await reserve(tenantId, grantId, 'mutating')).toBe(false);
    expect(await spent(tenantId, grantId)).toEqual({ writes: 20, creates: 0 });
  });

  it('admits ten creates, each also a mutating call, and refuses the eleventh', async () => {
    const { tenantId, grantId } = await grantIn();
    for (let i = 0; i < 10; i += 1) expect(await reserve(tenantId, grantId, 'create')).toBe(true);
    expect(await reserve(tenantId, grantId, 'create')).toBe(false);
    expect(await spent(tenantId, grantId)).toEqual({ writes: 10, creates: 10 });
    for (let i = 0; i < 10; i += 1) expect(await reserve(tenantId, grantId, 'mutating')).toBe(true);
    expect(await reserve(tenantId, grantId, 'mutating')).toBe(false);
    expect(await reserve(tenantId, grantId, 'create')).toBe(false);
  });

  it('admits exactly the limit when forty ask at once from separate transactions', async () => {
    const { tenantId, grantId } = await grantIn();
    const answers = await Promise.all(
      Array.from({ length: 40 }, () => reserve(tenantId, grantId, 'mutating')),
    );
    expect(answers.filter(Boolean)).toHaveLength(20);
    expect(await spent(tenantId, grantId)).toEqual({ writes: 20, creates: 0 });
  });

  it('admits exactly ten creates and twenty in all when a mixed forty ask at once', async () => {
    const { tenantId, grantId } = await grantIn();
    const kinds = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'create' : 'mutating'));
    const answers = await Promise.all(kinds.map((kind) => reserve(tenantId, grantId, kind)));
    const admitted = kinds.filter((_, i) => answers[i]);
    expect(admitted).toHaveLength(20);
    expect(admitted.filter((kind) => kind === 'create').length).toBeLessThanOrEqual(10);
    const row = await spent(tenantId, grantId);
    expect(row?.writes).toBe(20);
    expect(row?.creates).toBe(admitted.filter((kind) => kind === 'create').length);
  });

  it('gives a call back, and never goes below nothing', async () => {
    const { tenantId, grantId } = await grantIn();
    for (let i = 0; i < 10; i += 1) await reserve(tenantId, grantId, 'create');
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).releaseAgentWrite(grantId, 'create'),
    );
    expect(await spent(tenantId, grantId)).toEqual({ writes: 9, creates: 9 });
    expect(await reserve(tenantId, grantId, 'create')).toBe(true);
    const fresh = await grantIn();
    await withTenant(app.db, fresh.tenantId, (tx) =>
      tokenGrantRepository(tx).releaseAgentWrite(fresh.grantId, 'create'),
    );
    expect(await spent(fresh.tenantId, fresh.grantId)).toEqual({ writes: 0, creates: 0 });
  });

  it('keeps one budget for each grant', async () => {
    const first = await grantIn();
    const second = await grantIn();
    for (let i = 0; i < 20; i += 1) await reserve(first.tenantId, first.grantId, 'mutating');
    expect(await reserve(first.tenantId, first.grantId, 'mutating')).toBe(false);
    expect(await reserve(second.tenantId, second.grantId, 'mutating')).toBe(true);
  });

  it('refuses a grant that does not exist and a grant that was revoked', async () => {
    const { tenantId, grantId } = await grantIn();
    expect(await reserve(tenantId, newId(), 'mutating')).toBe(false);
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );
    expect(await reserve(tenantId, grantId, 'mutating')).toBe(false);
  });

  async function exchangedFrom(tenantId: string, parentId: string): Promise<string> {
    return withTenant(app.db, tenantId, async (tx) => {
      const parent = await tokenGrantRepository(tx).byId(parentId);
      if (parent === null) throw new Error('no parent grant');
      const child = await tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: parent.clientId,
        subjectId: parent.subjectId,
        scope: 'mcp:write',
        audience: parent.audience,
        exchangedFromGrantId: parentId,
        actorSubjectId: parent.subjectId,
      });
      return child.id;
    });
  }

  it('is one budget for a grant and every grant exchanged from it, however deep', async () => {
    const { tenantId, grantId } = await grantIn();
    const child = await exchangedFrom(tenantId, grantId);
    const grandchild = await exchangedFrom(tenantId, child);
    for (let i = 0; i < 20; i += 1) expect(await reserve(tenantId, grantId, 'mutating')).toBe(true);
    expect(await reserve(tenantId, child, 'mutating')).toBe(false);
    expect(await reserve(tenantId, grandchild, 'mutating')).toBe(false);
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).releaseAgentWrite(grandchild, 'mutating'),
    );
    expect(await reserve(tenantId, child, 'mutating')).toBe(true);
    expect(await spent(tenantId, grantId)).toEqual({ writes: 20, creates: 0 });
  });

  it('ends with the grant it was exchanged from', async () => {
    const { tenantId, grantId } = await grantIn();
    const child = await exchangedFrom(tenantId, grantId);
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );
    expect(await reserve(tenantId, child, 'mutating')).toBe(false);
    expect(await withTenant(app.db, tenantId, (tx) => tokenGrantRepository(tx).isLive(child))).toBe(
      false,
    );
  });

  it('says whether a grant is live, so a sign-in that ended is not read as a spent budget', async () => {
    const { tenantId, grantId } = await grantIn();
    const live = (id: string, tenant = tenantId) =>
      withTenant(app.db, tenant, (tx) => tokenGrantRepository(tx).isLive(id));
    expect(await live(grantId)).toBe(true);
    expect(await live(newId())).toBe(false);
    const other = await grantIn();
    expect(await live(other.grantId)).toBe(false);
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );
    expect(await live(grantId)).toBe(false);
  });

  it('cannot spend, or give back, a foreign tenant’s grant, even given its id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const grantId = await seedGrant(tx, tenantId);
        await tokenGrantRepository(tx).reserveAgentWrite(grantId, 'create', LIMITS);
        return { grantId };
      },
      verifySeeded: async (tx, seeded) => {
        const [row] = await tx
          .select({ writes: tokenGrants.agentWrites })
          .from(tokenGrants)
          .where(eq(tokenGrants.id, seeded.grantId));
        expect(row?.writes).toBe(1);
      },
      attempt: async (tx, seeded) => {
        const admitted = await tokenGrantRepository(tx).reserveAgentWrite(
          seeded.grantId,
          'create',
          LIMITS,
        );
        await tokenGrantRepository(tx).releaseAgentWrite(seeded.grantId, 'create');
        return admitted;
      },
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const [row] = await tx
          .select({ writes: tokenGrants.agentWrites, creates: tokenGrants.agentCreates })
          .from(tokenGrants)
          .where(eq(tokenGrants.id, seeded.grantId));
        expect(row).toEqual({ writes: 1, creates: 1 });
      },
    });
  });
});
