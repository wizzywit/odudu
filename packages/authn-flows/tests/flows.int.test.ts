import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { clientScopeRepository, TENANT_DEFAULT_SCOPE_NAMES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flowRepository } from '#/repository/flows';
import { MAX_FLOWS_PER_TENANT } from '#/service/flow';
import {
  BROWSER_FLOW_DEFAULT,
  provisionBrowserFlow,
  provisionTenant,
} from '#/usecase/provision-flow';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(tenantId: string): Promise<void> {
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  });
}

describe('provisionBrowserFlow', () => {
  it('gives a freshly provisioned tenant one default flow holding the default steps in order', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const all = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      return flowRepository(tx).forTenant(tenantId);
    });

    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ tenantId, name: 'default', isDefault: true });
    expect(all[0]?.steps).toEqual([...BROWSER_FLOW_DEFAULT]);
  });

  it('is idempotent: provisioning twice still leaves exactly one default', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const all = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      await provisionBrowserFlow(tx, tenantId);
      return flowRepository(tx).forTenant(tenantId);
    });
    expect(all).toHaveLength(1);
  });
});

describe('provisionTenant', () => {
  // The claim that a tenant is never left half-provisioned is only checked
  // if something asserts both halves landed from the one call a real
  // tenant-creation site makes, not just that each function works in
  // isolation.
  it('gives a tenant both its scope vocabulary and its browser flow', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const [scopeNames, fallback] = await withTenant(app.db, tenantId, async (tx) => {
      await provisionTenant(tx, tenantId);
      const scopes = await clientScopeRepository(tx).allForTenant();
      const flow = await flowRepository(tx).defaultForTenant(tenantId);
      return [scopes.map((scope) => scope.name), flow] as const;
    });

    expect(scopeNames.sort()).toEqual([...TENANT_DEFAULT_SCOPE_NAMES].sort());
    expect(fallback?.steps.map((step) => step.authenticator)).toEqual(
      BROWSER_FLOW_DEFAULT.map((step) => step.authenticator),
    );
  });
});

describe('flowRepository', () => {
  it("cannot see a foreign tenant's flows through forTenant", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        await provisionBrowserFlow(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await flowRepository(tx).forTenant(tenantId)).toHaveLength(1);
      },
      attempt: async (tx, tenantId) => flowRepository(tx).forTenant(tenantId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it("cannot see a foreign tenant's default flow through defaultForTenant", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        await provisionBrowserFlow(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        expect(await flowRepository(tx).defaultForTenant(tenantId)).not.toBeNull();
      },
      attempt: async (tx, tenantId) => flowRepository(tx).defaultForTenant(tenantId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('replaces the default flow steps wholesale, keeping its id', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const [before, replaced, after] = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const first = await repository.defaultForTenant(tenantId);
      const written = await repository.replaceDefaultSteps(tenantId, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'conditional' },
      ]);
      return [first, written, await repository.forTenant(tenantId)] as const;
    });

    expect(replaced.id).toBe(before?.id);
    expect(replaced.steps.map((step) => [step.authenticator, step.requirement])).toEqual([
      ['password', 'required'],
      ['otp', 'conditional'],
    ]);
    expect(after).toHaveLength(1);
    expect(after[0]?.steps).toEqual(replaced.steps);
  });

  it('creates the default flow when the tenant has none', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const found = await withTenant(app.db, tenantId, async (tx) => {
      await flowRepository(tx).replaceDefaultSteps(tenantId, [
        { authenticator: 'password', requirement: 'required' },
      ]);
      return flowRepository(tx).defaultForTenant(tenantId);
    });
    expect(found?.isDefault).toBe(true);
  });

  it('finds the default by is_default, even renamed while another flow holds the name default', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const written = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      await tx.execute(sql`update flows set name = 'main' where tenant_id = ${tenantId}`);
      await tx.execute(
        sql`insert into flows (id, tenant_id, name, is_default, steps)
            values (${newId()}, ${tenantId}, 'default', false, '[]'::jsonb)`,
      );
      return flowRepository(tx).replaceDefaultSteps(tenantId, [
        { authenticator: 'password', requirement: 'required' },
      ]);
    });
    expect(written).toMatchObject({ name: 'main', isDefault: true });
  });

  it('replacing with an empty list leaves a default flow with no steps', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const after = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      await flowRepository(tx).replaceDefaultSteps(tenantId, []);
      return flowRepository(tx).defaultForTenant(tenantId);
    });
    expect(after?.steps).toEqual([]);
  });

  // The isolation policy's USING doubles as its WITH CHECK with none
  // declared (expectTenantIsolation's own doc comment, @odudu/db), so a
  // write carrying a foreign tenant_id is rejected outright rather than
  // silently writing nothing.
  it('cannot replace a foreign tenant flow, and leaves it unaffected', async () => {
    const tenantA = newId();
    await seedTenant(tenantA);
    await withTenant(app.db, tenantA, (tx) => provisionBrowserFlow(tx, tenantA));

    const tenantB = newId();
    await seedTenant(tenantB);

    let error: unknown;
    try {
      await withTenant(app.db, tenantB, (tx) =>
        flowRepository(tx).replaceDefaultSteps(tenantA, [
          { authenticator: 'password', requirement: 'required' },
        ]),
      );
      expect.unreachable('expected the cross-tenant write to be rejected');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('row-level security');

    const after = await withTenant(app.db, tenantA, (tx) =>
      flowRepository(tx).defaultForTenant(tenantA),
    );
    expect(after?.steps).toEqual([...BROWSER_FLOW_DEFAULT]);
  });

  it('refuses a step list the schema refuses before it reaches the database', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    await expect(
      withTenant(app.db, tenantId, (tx) =>
        flowRepository(tx).replaceDefaultSteps(tenantId, [
          { authenticator: 'password', requirement: 'sometimes' as 'required' },
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe('the flows table', () => {
  async function insertFlow(
    tenantId: string,
    name: string,
    isDefault: boolean,
    steps = '[]',
  ): Promise<void> {
    await owner.sql`
      insert into flows (id, tenant_id, name, is_default, steps)
      values (${newId()}, ${tenantId}, ${name}, ${isDefault}, ${steps}::jsonb)`;
  }

  it('allows exactly one default flow per tenant, and any number of the others', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    await insertFlow(tenantId, 'default', true);
    await insertFlow(tenantId, 'staff', false);
    await insertFlow(tenantId, 'partners', false);

    await expect(insertFlow(tenantId, 'second', true)).rejects.toMatchObject({
      constraint_name: 'flows_one_default',
    });

    const otherTenant = newId();
    await seedTenant(otherTenant);
    await insertFlow(otherTenant, 'default', true);
  });

  it('refuses a second flow of the same name in a tenant', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    await insertFlow(tenantId, 'staff', false);

    await expect(insertFlow(tenantId, 'staff', false)).rejects.toMatchObject({
      constraint_name: 'flows_tenant_name',
    });
  });

  it('refuses a name that is empty or past 64 characters', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    await expect(insertFlow(tenantId, '', false)).rejects.toMatchObject({
      constraint_name: 'flows_name_length',
    });
    await expect(insertFlow(tenantId, 'x'.repeat(65), false)).rejects.toMatchObject({
      constraint_name: 'flows_name_length',
    });
  });

  it('refuses steps that are not an array, or that pass twenty', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    const step = '{"authenticator":"password","requirement":"required"}';

    await expect(insertFlow(tenantId, 'object', false, '{}')).rejects.toMatchObject({
      constraint_name: 'flows_steps_bounded',
    });
    await expect(
      insertFlow(tenantId, 'long', false, `[${Array(21).fill(step).join(',')}]`),
    ).rejects.toMatchObject({ constraint_name: 'flows_steps_bounded' });
  });

  it('reads at most the per-tenant cap of flows', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    for (let n = 0; n < MAX_FLOWS_PER_TENANT + 3; n += 1) {
      await insertFlow(tenantId, `flow-${String(n).padStart(3, '0')}`, false);
    }

    const read = await withTenant(app.db, tenantId, (tx) => flowRepository(tx).forTenant(tenantId));
    expect(read).toHaveLength(MAX_FLOWS_PER_TENANT);
  });

  it('is gone with its tenant', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);
    await insertFlow(tenantId, 'default', true);

    await owner.sql`delete from tenants where id = ${tenantId}`;
    const [row] = await owner.sql<{ n: number }[]>`
      select count(*)::int as n from flows where tenant_id = ${tenantId}`;
    expect(row?.n).toBe(0);
  });
});

describe('flowRepository writes of a named flow', () => {
  const steps = [{ authenticator: 'password', requirement: 'required' as const }];

  it('creates a non-default flow, finds it by id, counts it and orders the list by name', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const result = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const staff = await repository.create(tenantId, 'staff', steps);
      await repository.create(tenantId, 'admins', steps);
      return {
        staff,
        found: await repository.byId(tenantId, staff.id),
        count: await repository.countForTenant(tenantId),
        names: (await repository.forTenant(tenantId)).map((flow) => flow.name),
      };
    });

    expect(result.staff).toMatchObject({ name: 'staff', isDefault: false, steps });
    expect(result.found).toEqual(result.staff);
    expect(result.count).toBe(3);
    expect(result.names).toEqual(['admins', 'default', 'staff']);
  });

  it('refuses a second flow of the same name with the table constraint', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await flowRepository(tx).create(tenantId, 'staff', steps);
        await flowRepository(tx).create(tenantId, 'staff', steps);
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'flows_tenant_name' } });
  });

  it('replaces the name and steps of one flow and answers null for an unknown id', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const result = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const staff = await repository.create(tenantId, 'staff', steps);
      return {
        replaced: await repository.replace(tenantId, staff.id, 'crew', []),
        missing: await repository.replace(tenantId, newId(), 'x', steps),
        defaultKept: (await repository.defaultForTenant(tenantId))?.name,
      };
    });

    expect(result.replaced).toMatchObject({ name: 'crew', isDefault: false, steps: [] });
    expect(result.missing).toBeNull();
    expect(result.defaultKept).toBe('default');
  });

  it('removes a non-default flow, and never the default', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const result = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const staff = await repository.create(tenantId, 'staff', steps);
      const defaultFlow = await repository.defaultForTenant(tenantId);
      return {
        removed: await repository.remove(tenantId, staff.id),
        again: await repository.remove(tenantId, staff.id),
        defaultRemoved: await repository.remove(tenantId, defaultFlow?.id ?? ''),
        left: await repository.countForTenant(tenantId),
      };
    });

    expect(result).toEqual({ removed: true, again: false, defaultRemoved: false, left: 1 });
  });

  it("cannot read, count, replace or remove a foreign tenant's flow", async () => {
    const tenantA = newId();
    await seedTenant(tenantA);
    const flowId = await withTenant(app.db, tenantA, async (tx) => {
      await provisionBrowserFlow(tx, tenantA);
      return (await flowRepository(tx).create(tenantA, 'staff', steps)).id;
    });
    const tenantB = newId();
    await seedTenant(tenantB);

    const result = await withTenant(app.db, tenantB, async (tx) => {
      const repository = flowRepository(tx);
      return {
        found: await repository.byId(tenantA, flowId),
        count: await repository.countForTenant(tenantA),
        replaced: await repository.replace(tenantA, flowId, 'taken', steps),
        removed: await repository.remove(tenantA, flowId),
      };
    });
    expect(result).toEqual({ found: null, count: 0, replaced: null, removed: false });

    const untouched = await withTenant(app.db, tenantA, (tx) =>
      flowRepository(tx).byId(tenantA, flowId),
    );
    expect(untouched?.name).toBe('staff');
  });

  it('cannot create a flow carrying a foreign tenant id', async () => {
    const tenantA = newId();
    await seedTenant(tenantA);
    const tenantB = newId();
    await seedTenant(tenantB);

    await expect(
      withTenant(app.db, tenantB, (tx) => flowRepository(tx).create(tenantA, 'staff', steps)),
    ).rejects.toThrow();
  });
});

describe('flowRepository.makeDefault', () => {
  const steps = [{ authenticator: 'password', requirement: 'required' as const }];

  it('moves the default to another flow, leaving exactly one', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const result = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const staff = await repository.create(tenantId, 'staff', steps);
      const promoted = await repository.makeDefault(tenantId, staff.id);
      const all = await repository.forTenant(tenantId);
      return { promoted, defaults: all.filter((flow) => flow.isDefault).map((flow) => flow.name) };
    });

    expect(result.promoted).toMatchObject({ name: 'staff', isDefault: true });
    expect(result.defaults).toEqual(['staff']);
  });

  it('changes nothing for the flow that is already the default', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const again = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      const repository = flowRepository(tx);
      const current = await repository.defaultForTenant(tenantId);
      return { current, again: await repository.makeDefault(tenantId, current?.id ?? '') };
    });
    expect(again.again).toEqual(again.current);
  });

  it("answers null for an unknown id and cannot touch a foreign tenant's flow", async () => {
    const tenantA = newId();
    await seedTenant(tenantA);
    const flowId = await withTenant(app.db, tenantA, async (tx) => {
      await provisionBrowserFlow(tx, tenantA);
      return (await flowRepository(tx).create(tenantA, 'staff', steps)).id;
    });
    const tenantB = newId();
    await seedTenant(tenantB);

    const result = await withTenant(app.db, tenantB, async (tx) => {
      await provisionBrowserFlow(tx, tenantB);
      const repository = flowRepository(tx);
      return {
        unknown: await repository.makeDefault(tenantB, newId()),
        foreign: await repository.makeDefault(tenantA, flowId),
      };
    });
    expect(result).toEqual({ unknown: null, foreign: null });

    const stillDefault = await withTenant(app.db, tenantA, (tx) =>
      flowRepository(tx).defaultForTenant(tenantA),
    );
    expect(stillDefault?.name).toBe('default');
  });
});
