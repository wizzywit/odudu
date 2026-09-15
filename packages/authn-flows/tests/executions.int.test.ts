import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executionRepository } from '#/repository/executions';
import { type Requirement } from '#/schema/execution';
import { BROWSER_FLOW_DEFAULT, provisionBrowserFlow } from '#/usecase/provision-flow';

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

async function seedRealm(realmId: string): Promise<void> {
  await withRealm(app.db, realmId, async (tx) => {
    await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  });
}

describe('provisionBrowserFlow', () => {
  it('gives a freshly provisioned realm exactly the three default executions in order', async () => {
    const realmId = newId();
    await seedRealm(realmId);

    const executions = await withRealm(app.db, realmId, async (tx) => {
      await provisionBrowserFlow(tx, realmId);
      return executionRepository(tx).forRealm(realmId);
    });

    expect(
      executions.map((execution) => ({ ...execution, id: undefined, realmId: undefined })),
    ).toEqual(
      BROWSER_FLOW_DEFAULT.map((execution, index) => ({
        id: undefined,
        realmId: undefined,
        index,
        authenticator: execution.authenticator,
        requirement: execution.requirement,
      })),
    );
    expect(executions.map((execution) => execution.index)).toEqual([0, 1, 2]);
  });
});

describe('executionRepository', () => {
  it("cannot see a foreign realm's executions through forRealm", async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
        await provisionBrowserFlow(tx, realmId);
        return realmId;
      },
      verifySeeded: async (tx, realmId) => {
        const found = await executionRepository(tx).forRealm(realmId);
        expect(found).toHaveLength(BROWSER_FLOW_DEFAULT.length);
      },
      attempt: async (tx, realmId) => executionRepository(tx).forRealm(realmId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('refuses a second execution at an index a realm already uses', async () => {
    const realmId = newId();
    await seedRealm(realmId);

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        const repository = executionRepository(tx);
        await repository.create({
          realmId,
          index: 0,
          authenticator: 'passkey',
          requirement: 'alternative',
        });
        await repository.create({
          realmId,
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

  it('refuses a requirement outside required/alternative/conditional/disabled', async () => {
    const realmId = newId();
    await seedRealm(realmId);

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        await executionRepository(tx).create({
          realmId,
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
