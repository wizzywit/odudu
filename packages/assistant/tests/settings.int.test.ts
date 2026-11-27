import { ASSISTANT_SETTING_DEFAULTS, type AssistantSettings } from '@odudu/contracts/admin';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withSavepoint,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settingsRepository } from '#/repository/settings';

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

const NOW = new Date('2026-11-26T10:00:00.000Z');
const CHOSEN: AssistantSettings = {
  assistant_enabled: false,
  assistant_default_mode: 'act',
  assistant_mask_emails: true,
  assistant_trace_retention_days: 90,
  assistant_auditor_visible: false,
  assistant_monthly_tokens_fast: 10,
  assistant_monthly_tokens_standard: 20,
  assistant_monthly_tokens_deep: 30,
  assistant_max_concurrent: 2,
  assistant_max_steps_per_turn: 7,
};

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `settings-${tenantId.slice(-12)}` });
}

async function inFreshTenant<T>(
  fn: (tx: TenantScopedDatabase, tenantId: string) => Promise<T>,
): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    return fn(tx, tenantId);
  });
}

describe('settingsRepository', () => {
  it('reads nothing for a tenant that has chosen nothing', async () => {
    await inFreshTenant(async (tx, tenantId) => {
      expect(await settingsRepository(tx).get(tenantId)).toBeNull();
    });
  });

  it('stores every setting and reads it back, a second put replacing the first', async () => {
    await inFreshTenant(async (tx, tenantId) => {
      const repository = settingsRepository(tx);
      await repository.put(tenantId, ASSISTANT_SETTING_DEFAULTS, NOW);
      expect(await repository.get(tenantId)).toEqual(ASSISTANT_SETTING_DEFAULTS);
      await repository.put(tenantId, CHOSEN, NOW);
      expect(await repository.get(tenantId)).toEqual(CHOSEN);
      const [count] = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from assistant_settings`,
      );
      expect(count?.n).toBe('1');
    });
  });

  it('refuses a value outside the range the database holds', async () => {
    const tenantId = newId();
    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        await settingsRepository(tx).put(
          tenantId,
          { ...CHOSEN, assistant_trace_retention_days: 366 },
          NOW,
        );
      }),
    ).rejects.toThrow();
  });
});

describe('every method refuses a foreign tenant', () => {
  const seed = async (tx: TenantScopedDatabase, tenantId: string): Promise<string> => {
    await seedTenant(tx, tenantId);
    await settingsRepository(tx).put(tenantId, CHOSEN, NOW);
    return tenantId;
  };
  const verifySeeded = async (tx: TenantScopedDatabase, tenantId: string): Promise<void> => {
    expect(await settingsRepository(tx).get(tenantId)).toEqual(CHOSEN);
  };

  it('get reads nothing of another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded,
      attempt: async (tx, tenantId) => settingsRepository(tx).get(tenantId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: verifySeeded,
    });
  });

  it('put cannot write another tenant row', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded,
      attempt: async (tx, tenantId) => {
        try {
          await withSavepoint(tx, async (inner) =>
            settingsRepository(inner).put(
              tenantId,
              { ...CHOSEN, assistant_max_concurrent: 9 },
              NOW,
            ),
          );
          return 'written';
        } catch {
          return 'refused';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('refused');
      },
      verifyTenantAUnaffected: verifySeeded,
    });
  });
});
