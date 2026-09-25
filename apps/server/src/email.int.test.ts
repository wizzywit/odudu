import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { tenantSmtpRepository } from '@odudu/protocol-admin';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSender } from '#/email';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
const logger = pino({ level: 'silent' });

const baseConfig = {
  ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu',
  ODUDU_KEK: KEK.toString('base64'),
};

async function seedTenant(): Promise<string> {
  const tenantId = crypto.randomUUID();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `email-${tenantId}` });
  });
  return tenantId;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('resolveSender', () => {
  it('prefers the tenant own row over the environment sender', async () => {
    const tenantId = await seedTenant();
    await withTenant(app.db, tenantId, (tx) =>
      tenantSmtpRepository(tx).upsert(tenantId, {
        host: 'tenant.smtp.example',
        port: 587,
        fromAddress: 'noreply@tenant.example',
        username: null,
        passwordEncrypted: null,
        starttls: false,
      }),
    );
    const config = loadConfig({
      ...baseConfig,
      ODUDU_SMTP_HOST: 'env.smtp.example',
      ODUDU_SMTP_FROM: 'noreply@env.example',
    });

    const sender = await resolveSender({ database: app.db, kek: KEK, config, logger }, tenantId);

    expect(sender.kind).toBe('smtp');
    expect(sender).toMatchObject({ host: 'tenant.smtp.example' });
  });

  it('falls back to the environment sender when the tenant has no row', async () => {
    const tenantId = await seedTenant();
    const config = loadConfig({
      ...baseConfig,
      ODUDU_SMTP_HOST: 'env.smtp.example',
      ODUDU_SMTP_FROM: 'noreply@env.example',
    });

    const sender = await resolveSender({ database: app.db, kek: KEK, config, logger }, tenantId);

    expect(sender.kind).toBe('smtp');
    expect(sender).toMatchObject({ host: 'env.smtp.example' });
  });

  it('falls back to capturing when neither the tenant nor the environment has a sender', async () => {
    const tenantId = await seedTenant();
    const config = loadConfig(baseConfig);

    const sender = await resolveSender({ database: app.db, kek: KEK, config, logger }, tenantId);

    expect(sender.kind).toBe('capturing');
  });
});
