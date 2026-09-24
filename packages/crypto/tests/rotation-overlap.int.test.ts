import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signingKeyRepository } from '#/repository/signing-keys';
import { signingKeys } from '#/schema/signing-keys';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const PUBLIC_JWK = { kty: 'RSA', n: 'n-value', e: 'AQAB' };
const PRIVATE_ENCRYPTED = 'ciphertext-placeholder';

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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function seedKey(
  tx: TenantScopedDatabase,
  tenantId: string,
  overrides: Partial<typeof signingKeys.$inferInsert> = {},
): Promise<{ id: string }> {
  const id = overrides.id ?? newId();
  await tx.insert(signingKeys).values({
    tenantId,
    kid: newId(),
    alg: 'RS256',
    status: 'active',
    publicJwk: PUBLIC_JWK,
    privateJwkEncrypted: PRIVATE_ENCRYPTED,
    ...overrides,
    id,
  });
  return { id };
}

describe('the overlap window', () => {
  // Retiring early breaks every relying party holding an unexpired token
  // signed by that key, so the window ends when an operator retires the
  // key, never when `not_after` merely passes.
  it('keeps publishing a rotating key past not_after until retirement is explicit', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    // An `active` key of its own alg, so this tenant is never left with a
    // key that cannot sign anything — irrelevant to what is under test.
    await withTenant(app.db, tenantId, (tx) =>
      seedKey(tx, tenantId, { alg: 'ES256', status: 'active' }),
    );
    const key = await withTenant(app.db, tenantId, (tx) =>
      seedKey(tx, tenantId, {
        alg: 'RS256',
        status: 'rotating',
        notAfter: new Date(Date.now() - 365 * 24 * 3600 * 1000),
      }),
    );

    const published = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).listPublishable(),
    );
    expect(published.map((k) => k.id)).toContain(key.id);
  });

  it('stops publishing it once retired', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
    await withTenant(app.db, tenantId, (tx) =>
      seedKey(tx, tenantId, { alg: 'ES256', status: 'active' }),
    );
    const key = await withTenant(app.db, tenantId, (tx) =>
      seedKey(tx, tenantId, { alg: 'RS256', status: 'rotating' }),
    );

    await withTenant(app.db, tenantId, (tx) => signingKeyRepository(tx).retire(key.id));

    const published = await withTenant(app.db, tenantId, (tx) =>
      signingKeyRepository(tx).listPublishable(),
    );
    expect(published.map((k) => k.id)).not.toContain(key.id);
  });
});
