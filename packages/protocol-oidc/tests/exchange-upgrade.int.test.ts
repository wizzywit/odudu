import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { clientRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import {
  EXCHANGE_UPGRADE_COUNT_CAP,
  EXCHANGE_UPGRADE_SAMPLE_LIMIT,
  publicExchangeClientsAtRisk,
} from '#/repository/exchange-upgrade';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function tenantWith(
  name: string,
  clients: { clientId: string; type: 'public' | 'confidential'; exchange: boolean; open?: true }[],
): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    for (const spec of clients) {
      const client = await clientRepository(tx).create({
        tenantId,
        clientId: spec.clientId,
        name: spec.clientId,
        type: spec.type,
        secretHash: null,
      });
      await provisionClientDefaults(tx, client.id);
      await clientOidcConfigRepository(tx).create({
        clientId: client.id,
        tenantId,
        redirectUris: ['https://app.example/callback'],
        grantTypes: spec.exchange
          ? ['authorization_code', TOKEN_EXCHANGE_GRANT]
          : ['authorization_code'],
        tokenEndpointAuthMethod: spec.type === 'public' ? 'none' : 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 3600,
        ...(spec.open === true ? { tokenExchangeAllowedForPublic: true } : {}),
      });
    }
  });
  return tenantId;
}

describe('publicExchangeClientsAtRisk', () => {
  it('lists the public clients holding the grant with the setting off, and no others', async () => {
    await tenantWith('upgrade-a', [
      { clientId: 'stranded', type: 'public', exchange: true },
      { clientId: 'allowed', type: 'public', exchange: true, open: true },
      { clientId: 'no-grant', type: 'public', exchange: false },
      { clientId: 'secret-holder', type: 'confidential', exchange: true },
    ]);
    await tenantWith('upgrade-b', [{ clientId: 'also-stranded', type: 'public', exchange: true }]);

    const found = await publicExchangeClientsAtRisk(owner.db);

    expect(found.count).toBe(2);
    expect(found.sample.map((entry) => `${entry.tenant}/${entry.clientId}`).sort()).toEqual([
      'upgrade-a/stranded',
      'upgrade-b/also-stranded',
    ]);
  });

  it('names at most the sample limit and counts up to the cap', async () => {
    const many = Array.from({ length: EXCHANGE_UPGRADE_SAMPLE_LIMIT + 5 }, (_, index) => ({
      clientId: `bulk-${String(index)}`,
      type: 'public' as const,
      exchange: true,
    }));
    await tenantWith('upgrade-bulk', many);

    const found = await publicExchangeClientsAtRisk(owner.db);

    expect(found.sample).toHaveLength(EXCHANGE_UPGRADE_SAMPLE_LIMIT);
    expect(found.count).toBe(2 + EXCHANGE_UPGRADE_SAMPLE_LIMIT + 5);
    expect(EXCHANGE_UPGRADE_COUNT_CAP).toBe(10_000);
  });
});
