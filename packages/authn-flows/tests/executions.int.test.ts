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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executionRepository } from '#/repository/executions';
import { type Requirement } from '#/schema/execution';
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
  it('gives a freshly provisioned tenant exactly the default executions in order', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const executions = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      return executionRepository(tx).forTenant(tenantId);
    });

    expect(
      executions.map((execution) => ({ ...execution, id: undefined, tenantId: undefined })),
    ).toEqual(
      BROWSER_FLOW_DEFAULT.map((execution, index) => ({
        id: undefined,
        tenantId: undefined,
        index,
        authenticator: execution.authenticator,
        requirement: execution.requirement,
      })),
    );
    expect(executions.map((execution) => execution.index)).toEqual(
      BROWSER_FLOW_DEFAULT.map((_, index) => index),
    );
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

    const [scopeNames, executions] = await withTenant(app.db, tenantId, async (tx) => {
      await provisionTenant(tx, tenantId);
      const scopes = await clientScopeRepository(tx).allForTenant();
      const flow = await executionRepository(tx).forTenant(tenantId);
      return [scopes.map((scope) => scope.name), flow] as const;
    });

    expect(scopeNames.sort()).toEqual([...TENANT_DEFAULT_SCOPE_NAMES].sort());
    expect(executions.map((execution) => execution.authenticator)).toEqual(
      BROWSER_FLOW_DEFAULT.map((execution) => execution.authenticator),
    );
    expect(executions.map((execution) => execution.index)).toEqual(
      BROWSER_FLOW_DEFAULT.map((_, index) => index),
    );
  });
});

describe('executionRepository', () => {
  it("cannot see a foreign tenant's executions through forTenant", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        await provisionBrowserFlow(tx, tenantId);
        return tenantId;
      },
      verifySeeded: async (tx, tenantId) => {
        const found = await executionRepository(tx).forTenant(tenantId);
        expect(found).toHaveLength(BROWSER_FLOW_DEFAULT.length);
      },
      attempt: async (tx, tenantId) => executionRepository(tx).forTenant(tenantId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('refuses a second execution at an index a tenant already uses', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        const repository = executionRepository(tx);
        await repository.create({
          tenantId,
          index: 0,
          authenticator: 'passkey',
          requirement: 'alternative',
        });
        await repository.create({
          tenantId,
          index: 0,
          authenticator: 'password',
          requirement: 'alternative',
        });
      });
      expect.unreachable('expected the duplicate index to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('authentication_executions_order');
  });

  it('replaces a tenant flow wholesale, renumbering from array order', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const replaced = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      return executionRepository(tx).replaceForTenant(tenantId, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'conditional' },
      ]);
    });

    expect(replaced.map((row) => [row.index, row.authenticator, row.requirement])).toEqual([
      [0, 'password', 'required'],
      [1, 'otp', 'conditional'],
    ]);

    const after = await withTenant(app.db, tenantId, (tx) =>
      executionRepository(tx).forTenant(tenantId),
    );
    expect(after.map((row) => [row.index, row.authenticator])).toEqual([
      [0, 'password'],
      [1, 'otp'],
    ]);
  });

  it('replacing with an empty list leaves a tenant with no executions at all', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    const after = await withTenant(app.db, tenantId, async (tx) => {
      await provisionBrowserFlow(tx, tenantId);
      await executionRepository(tx).replaceForTenant(tenantId, []);
      return executionRepository(tx).forTenant(tenantId);
    });
    expect(after).toEqual([]);
  });

  // Unlike `forTenant` (a plain SELECT, silently empty across tenants),
  // `replaceForTenant` writes: the isolation policy's USING doubles as its
  // WITH CHECK with none declared (expectTenantIsolation's own doc comment,
  // @odudu/db), so an INSERT carrying a foreign tenant_id is rejected
  // outright rather than silently inserting nothing.
  it('cannot replace a foreign tenant flow through replaceForTenant, and leaves it unaffected', async () => {
    const tenantA = newId();
    await seedTenant(tenantA);
    await withTenant(app.db, tenantA, (tx) => provisionBrowserFlow(tx, tenantA));

    const tenantB = newId();
    await seedTenant(tenantB);

    let error: unknown;
    try {
      await withTenant(app.db, tenantB, (tx) =>
        executionRepository(tx).replaceForTenant(tenantA, [
          { authenticator: 'password', requirement: 'required' },
        ]),
      );
      expect.unreachable('expected the cross-tenant insert to be rejected');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('row-level security');

    const after = await withTenant(app.db, tenantA, (tx) =>
      executionRepository(tx).forTenant(tenantA),
    );
    expect(after).toHaveLength(BROWSER_FLOW_DEFAULT.length);
  });

  it('refuses a requirement outside required/alternative/conditional/disabled', async () => {
    const tenantId = newId();
    await seedTenant(tenantId);

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await executionRepository(tx).create({
          tenantId,
          index: 0,
          authenticator: 'password',
          requirement: 'sometimes' as Requirement,
        });
      });
      expect.unreachable('expected the invalid requirement to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('authentication_executions_requirement');
  });
});
