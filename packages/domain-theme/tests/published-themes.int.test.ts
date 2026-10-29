import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetRepository } from '#/repository/assets';
import { publishedThemeRepository } from '#/repository/published-themes';
import { themeRepository } from '#/repository/themes';
import { themeAssets } from '#/schema/theme-assets';
import { type ThemeBody } from '#/service/body';
import { type ThemeScope } from '#/service/record';
import { eq } from 'drizzle-orm';

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

function body(label: string, assetId?: string): ThemeBody {
  return {
    tokens: {},
    stylesheet: label,
    templates: {},
    assets: assetId === undefined ? {} : { logo: { assetId, alt: 'logo' } },
  };
}

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function seedClient(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<{ id: string; oauthId: string }> {
  const id = newId();
  const oauthId = `client-${id}`;
  await tx.insert(clients).values({
    id,
    tenantId,
    clientId: oauthId,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return { id, oauthId };
}

async function publish(scope: ThemeScope, themeBody: ThemeBody): Promise<void> {
  await withTenant(app.db, scope.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
}

async function storeAsset(
  tenantId: string,
  label: string,
): Promise<{ id: string; sha256: string }> {
  const stored = await withTenant(app.db, tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId,
      sha256: label.padEnd(64, '0'),
      mime: 'image/png',
      width: 4,
      height: 3,
      bytes: Buffer.from(label),
      tenantCapBytes: 1024,
    }),
  );
  if (stored === 'over_cap') throw new Error('asset refused');
  return stored;
}

async function layersOf(tenantId: string, oauthClientId: string | null) {
  return withTenant(app.db, tenantId, (tx) =>
    publishedThemeRepository(tx).forRender(tenantId, oauthClientId),
  );
}

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  return tenantId;
}

describe('publishedThemeRepository.forRender', () => {
  it('returns the tenant row and the client row together', async () => {
    const tenantId = await freshTenant();
    const client = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publish({ tenantId, clientId: null }, body('tenant'));
    await publish({ tenantId, clientId: client.id }, body('client'));

    const layers = await layersOf(tenantId, client.oauthId);
    expect(layers.tenant?.body).toEqual(body('tenant'));
    expect(layers.client?.body).toEqual(body('client'));
    expect(layers.tenant?.version).toBe(1);
  });

  it('returns no client layer for a client with no theme, an unknown id or none', async () => {
    const tenantId = await freshTenant();
    const themed = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    const plain = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publish({ tenantId, clientId: null }, body('tenant'));
    await publish({ tenantId, clientId: themed.id }, body('client'));

    for (const asked of [plain.oauthId, 'no-such-client', "x'; drop table clients; --", null]) {
      const layers = await layersOf(tenantId, asked);
      expect(layers.client).toBeNull();
      expect(layers.tenant?.body).toEqual(body('tenant'));
    }
  });

  it("does not return another tenant's client theme for that client's id", async () => {
    const tenantA = await freshTenant();
    const tenantB = await freshTenant();
    const foreign = await withTenant(app.db, tenantB, (tx) => seedClient(tx, tenantB));
    await publish({ tenantId: tenantA, clientId: null }, body('a'));
    await publish({ tenantId: tenantB, clientId: foreign.id }, body('b-client'));

    const layers = await layersOf(tenantA, foreign.oauthId);
    expect(layers.client).toBeNull();
    expect(layers.tenant?.body).toEqual(body('a'));
  });

  it('leaves out the client layer of a disabled client when asked for enabled ones only', async () => {
    const tenantId = await freshTenant();
    const client = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publish({ tenantId, clientId: null }, body('tenant'));
    await publish({ tenantId, clientId: client.id }, body('client'));
    const read = () =>
      withTenant(app.db, tenantId, (tx) =>
        publishedThemeRepository(tx).forRender(tenantId, client.oauthId, { enabledOnly: true }),
      );
    expect((await read()).client?.body).toEqual(body('client'));
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.id, client.id));
    const layers = await read();
    expect(layers.client).toBeNull();
    expect(layers.tenant?.body).toEqual(body('tenant'));
    expect((await layersOf(tenantId, client.oauthId)).client?.body).toEqual(body('client'));
  });

  it("does not return another tenant's client theme for an enabled-only read", async () => {
    const tenantA = await freshTenant();
    const tenantB = await freshTenant();
    const foreign = await withTenant(app.db, tenantB, (tx) => seedClient(tx, tenantB));
    await publish({ tenantId: tenantA, clientId: null }, body('a'));
    await publish({ tenantId: tenantB, clientId: foreign.id }, body('b-client'));
    const layers = await withTenant(app.db, tenantA, (tx) =>
      publishedThemeRepository(tx).forRender(tenantA, foreign.oauthId, { enabledOnly: true }),
    );
    expect(layers.client).toBeNull();
    expect(layers.tenant?.body).toEqual(body('a'));
  });

  it('reads published rows only, never a draft or an archived version', async () => {
    const tenantId = await freshTenant();
    await publish({ tenantId, clientId: null }, body('old'));
    await publish({ tenantId, clientId: null }, body('current'));
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft({ tenantId, clientId: null }, body('draft'), null),
    );

    const layers = await layersOf(tenantId, null);
    expect(layers.tenant?.body).toEqual(body('current'));
    expect(layers.tenant?.version).toBe(2);
  });

  it('returns nothing for a tenant with no published theme', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft({ tenantId, clientId: null }, body('draft'), null),
    );
    expect(await layersOf(tenantId, null)).toEqual({ tenant: null, client: null });
  });

  it('lists the images a version names, and not one that is gone', async () => {
    const tenantId = await freshTenant();
    const kept = await storeAsset(tenantId, 'kept');
    await publish({ tenantId, clientId: null }, body('with-logo', kept.id));
    expect((await layersOf(tenantId, null)).tenant?.assets).toEqual([
      {
        id: kept.id,
        sha256: kept.sha256,
        mime: 'image/png',
        width: 4,
        height: 3,
      },
    ]);

    await owner.db.delete(themeAssets).where(eq(themeAssets.id, kept.id));
    expect((await layersOf(tenantId, null)).tenant?.assets).toEqual([]);
  });

  it('finds nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const client = await seedClient(tx, tenantId);
        const themes = themeRepository(tx);
        await themes.saveDraft({ tenantId, clientId: null }, body('x'), null);
        await themes.publish({ tenantId, clientId: null });
        await themes.saveDraft({ tenantId, clientId: client.id }, body('y'), null);
        await themes.publish({ tenantId, clientId: client.id });
        return { tenantId, oauthId: client.oauthId };
      },
      verifySeeded: async (tx, seeded) => {
        const layers = await publishedThemeRepository(tx).forRender(
          seeded.tenantId,
          seeded.oauthId,
        );
        expect(layers.tenant).not.toBeNull();
        expect(layers.client).not.toBeNull();
      },
      attempt: (tx, seeded) =>
        publishedThemeRepository(tx).forRender(seeded.tenantId, seeded.oauthId),
      expectBlocked: (result) => {
        expect(result).toEqual({ tenant: null, client: null });
      },
    });
  });
});
