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
import { buildEmailSender, resolveSender } from '#/email';

// Every host these tests name is fictional, so the policy resolves them
// rather than asking DNS; the guard itself is unit-tested in
// packages/protocol-admin/src/service/smtp-destination.test.ts.
const PUBLIC_DESTINATION = {
  allowPrivate: false,
  resolve: () => Promise.resolve(['93.184.216.34']),
};

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
    const fallback = buildEmailSender(config, logger);

    const sender = await resolveSender(
      { database: app.db, kek: KEK, fallback, smtpDestination: PUBLIC_DESTINATION },
      tenantId,
    );

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
    const fallback = buildEmailSender(config, logger);

    const sender = await resolveSender(
      { database: app.db, kek: KEK, fallback, smtpDestination: PUBLIC_DESTINATION },
      tenantId,
    );

    expect(sender.kind).toBe('smtp');
    expect(sender).toMatchObject({ host: 'env.smtp.example' });
  });

  it('falls back to logging when neither the tenant nor the environment has a sender', async () => {
    const tenantId = await seedTenant();
    const config = loadConfig(baseConfig);
    const fallback = buildEmailSender(config, logger);

    const sender = await resolveSender(
      { database: app.db, kek: KEK, fallback, smtpDestination: PUBLIC_DESTINATION },
      tenantId,
    );

    expect(sender.kind).toBe('logging');
  });

  it('refuses a tenant row pointing inside the perimeter, rather than falling back', async () => {
    const tenantId = await seedTenant();
    await withTenant(app.db, tenantId, (tx) =>
      tenantSmtpRepository(tx).upsert(tenantId, {
        host: '169.254.169.254',
        port: 25,
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
    const fallback = buildEmailSender(config, logger);

    await expect(
      resolveSender(
        { database: app.db, kek: KEK, fallback, smtpDestination: PUBLIC_DESTINATION },
        tenantId,
      ),
    ).rejects.toThrow(/link-local/u);
  });

  it('decides the deployment fallback once at boot, not per resolution', async () => {
    // buildEmailSender is the boot-time decision (CLAUDE.md's "Decide at
    // boot what cannot change per tick"); resolveSender must use exactly
    // the fallback instance it is handed rather than re-deriving one.
    const tenantId = await seedTenant();
    const config = loadConfig(baseConfig);
    const fallback = buildEmailSender(config, logger);

    const sender = await resolveSender(
      { database: app.db, kek: KEK, fallback, smtpDestination: PUBLIC_DESTINATION },
      tenantId,
    );

    expect(sender).toBe(fallback);
  });
});
