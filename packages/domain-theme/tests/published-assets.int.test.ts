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
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetRepository } from '#/repository/assets';
import { publishedThemeRepository } from '#/repository/published-themes';
import { themeRepository } from '#/repository/themes';
import { themeAssets } from '#/schema/theme-assets';
import { type ThemeBody } from '#/service/body';
import { sha256Hex } from '#/service/branding-urls';
import { type ThemeScope } from '#/service/record';

let container: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await container?.stop();
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

async function seedClient(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const id = newId();
  await tx.insert(clients).values({
    id,
    tenantId,
    clientId: `client-${id}`,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return id;
}

async function store(
  tx: TenantScopedDatabase,
  tenantId: string,
  content: string,
): Promise<{ id: string; sha256: string }> {
  const bytes = Buffer.from(content);
  const stored = await assetRepository(tx).put({
    tenantId,
    sha256: sha256Hex(bytes),
    mime: 'image/webp',
    width: 2,
    height: 2,
    bytes,
    tenantCapBytes: 4096,
  });
  if (stored === 'over_cap') throw new Error('asset refused');
  return stored;
}

async function publish(scope: ThemeScope, themeBody: ThemeBody): Promise<void> {
  await withTenant(app.db, scope.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
}

async function fresh(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  return tenantId;
}

const served = (tenantId: string, sha256: string) =>
  withTenant(app.db, tenantId, (tx) => assetRepository(tx).getPublished(tenantId, sha256));

describe('assetRepository.getPublished', () => {
  it('returns the mime and bytes of an image a published tenant theme names', async () => {
    const tenantId = await fresh();
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'tenant-logo'));
    await publish({ tenantId, clientId: null }, body('t', logo.id));
    const row = await served(tenantId, logo.sha256);
    expect(row?.mime).toBe('image/webp');
    expect(row?.bytes.toString()).toBe('tenant-logo');
  });

  it('returns an image only a published client theme names', async () => {
    const tenantId = await fresh();
    const clientRow = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'client-logo'));
    await publish({ tenantId, clientId: null }, body('t'));
    await publish({ tenantId, clientId: clientRow }, body('c', logo.id));
    expect((await served(tenantId, logo.sha256))?.bytes.toString()).toBe('client-logo');
  });

  it('returns once for an image several published versions name', async () => {
    const tenantId = await fresh();
    const clientRow = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'shared'));
    await publish({ tenantId, clientId: null }, body('t', logo.id));
    await publish({ tenantId, clientId: clientRow }, body('c', logo.id));
    expect((await served(tenantId, logo.sha256))?.bytes.toString()).toBe('shared');
  });

  it('returns nothing for an image only a draft names', async () => {
    const tenantId = await fresh();
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'draft-logo'));
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft({ tenantId, clientId: null }, body('d', logo.id), null),
    );
    expect(await served(tenantId, logo.sha256)).toBeNull();
  });

  it('returns nothing once a later publish no longer names the image', async () => {
    const tenantId = await fresh();
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'old-logo'));
    await publish({ tenantId, clientId: null }, body('one', logo.id));
    expect(await served(tenantId, logo.sha256)).not.toBeNull();
    await publish({ tenantId, clientId: null }, body('two'));
    expect(await served(tenantId, logo.sha256)).toBeNull();
  });

  it('returns nothing for an uploaded image no theme names, and for a deleted one', async () => {
    const tenantId = await fresh();
    const loose = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'loose'));
    expect(await served(tenantId, loose.sha256)).toBeNull();

    const gone = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'gone'));
    await publish({ tenantId, clientId: null }, body('t', gone.id));
    expect(await served(tenantId, gone.sha256)).not.toBeNull();
    await owner.db.delete(themeAssets).where(eq(themeAssets.id, gone.id));
    expect(await served(tenantId, gone.sha256)).toBeNull();
  });

  it("returns nothing for another tenant's hash, even one its own theme names", async () => {
    const a = await fresh();
    const b = await fresh();
    const logo = await withTenant(app.db, a, (tx) => store(tx, a, 'a-only'));
    await publish({ tenantId: a, clientId: null }, body('a', logo.id));
    expect(await served(b, logo.sha256)).toBeNull();
    expect(await served(a, logo.sha256)).not.toBeNull();
  });

  it('finds nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const logo = await store(tx, tenantId, `probe-${tenantId}`);
        const themes = themeRepository(tx);
        await themes.saveDraft({ tenantId, clientId: null }, body('x', logo.id), null);
        await themes.publish({ tenantId, clientId: null });
        return { tenantId, sha256: logo.sha256 };
      },
      verifySeeded: async (tx, seeded) => {
        expect(
          await assetRepository(tx).getPublished(seeded.tenantId, seeded.sha256),
        ).not.toBeNull();
      },
      attempt: (tx, seeded) => assetRepository(tx).getPublished(seeded.tenantId, seeded.sha256),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('publishedThemeRepository.forStylesheet', () => {
  it('returns the tenant layer and the layer of the client row it names', async () => {
    const tenantId = await fresh();
    const clientRow = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publish({ tenantId, clientId: null }, body('tenant'));
    await publish({ tenantId, clientId: clientRow }, body('client'));
    const layers = await withTenant(app.db, tenantId, (tx) =>
      publishedThemeRepository(tx).forStylesheet(tenantId, clientRow),
    );
    expect(layers.client?.body).toEqual(body('client'));
    expect(layers.client?.clientId).toBe(clientRow);
    expect(layers.tenant?.body).toEqual(body('tenant'));
    const none = await withTenant(app.db, tenantId, (tx) =>
      publishedThemeRepository(tx).forStylesheet(tenantId, null),
    );
    expect(none.client).toBeNull();
    expect(none.tenant?.clientId).toBeNull();
  });

  it("selects nothing for another tenant's client row", async () => {
    const a = await fresh();
    const b = await fresh();
    const foreign = await withTenant(app.db, b, (tx) => seedClient(tx, b));
    await publish({ tenantId: a, clientId: null }, body('a'));
    await publish({ tenantId: b, clientId: foreign }, body('b-client'));
    const layers = await withTenant(app.db, a, (tx) =>
      publishedThemeRepository(tx).forStylesheet(a, foreign),
    );
    expect(layers.client).toBeNull();
    expect(layers.tenant?.body).toEqual(body('a'));
  });

  it('finds nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const clientRow = await seedClient(tx, tenantId);
        const themes = themeRepository(tx);
        await themes.saveDraft({ tenantId, clientId: clientRow }, body('y'), null);
        await themes.publish({ tenantId, clientId: clientRow });
        return { tenantId, clientRow };
      },
      verifySeeded: async (tx, seeded) => {
        const layers = await publishedThemeRepository(tx).forStylesheet(
          seeded.tenantId,
          seeded.clientRow,
        );
        expect(layers.client).not.toBeNull();
      },
      attempt: (tx, seeded) =>
        publishedThemeRepository(tx).forStylesheet(seeded.tenantId, seeded.clientRow),
      expectBlocked: (result) => {
        expect(result).toEqual({ tenant: null, client: null });
      },
    });
  });
});

describe('assetRepository.publishedMime', () => {
  it('answers what getPublished would, without bytes', async () => {
    const tenantId = await fresh();
    const logo = await withTenant(app.db, tenantId, (tx) => store(tx, tenantId, 'mime-logo'));
    const mime = () =>
      withTenant(app.db, tenantId, (tx) =>
        assetRepository(tx).publishedMime(tenantId, logo.sha256),
      );
    expect(await mime()).toBeNull();
    await publish({ tenantId, clientId: null }, body('t', logo.id));
    expect(await mime()).toBe('image/webp');
    await publish({ tenantId, clientId: null }, body('t2'));
    expect(await mime()).toBeNull();
  });

  it('finds nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const logo = await store(tx, tenantId, `mime-${tenantId}`);
        const themes = themeRepository(tx);
        await themes.saveDraft({ tenantId, clientId: null }, body('x', logo.id), null);
        await themes.publish({ tenantId, clientId: null });
        return { tenantId, sha256: logo.sha256 };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await assetRepository(tx).publishedMime(seeded.tenantId, seeded.sha256)).toBe(
          'image/webp',
        );
      },
      attempt: (tx, seeded) => assetRepository(tx).publishedMime(seeded.tenantId, seeded.sha256),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('publishedThemeRepository.identity', () => {
  it('names the published versions and the client row, and no more', async () => {
    const tenantId = await fresh();
    const clientRow = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publish({ tenantId, clientId: null }, body('tenant'));
    await publish({ tenantId, clientId: clientRow }, body('client'));
    const read = (client: string | null) =>
      withTenant(app.db, tenantId, (tx) => publishedThemeRepository(tx).identity(tenantId, client));
    const layers = await withTenant(app.db, tenantId, (tx) =>
      publishedThemeRepository(tx).forStylesheet(tenantId, clientRow),
    );
    const both = await read(clientRow);
    expect(both.tenant?.versionId).toBe(layers.tenant?.versionId);
    expect(both.client).toEqual({
      versionId: layers.client?.versionId,
      version: 1,
      clientId: clientRow,
    });
    expect((await read(null)).client).toBeNull();
    expect(Object.keys(both.tenant ?? {}).sort()).toEqual(['version', 'versionId']);
  });

  it("selects no client for another tenant's client row, and no draft", async () => {
    const a = await fresh();
    const b = await fresh();
    const foreign = await withTenant(app.db, b, (tx) => seedClient(tx, b));
    await publish({ tenantId: b, clientId: foreign }, body('b-client'));
    await withTenant(app.db, a, (tx) =>
      themeRepository(tx).saveDraft({ tenantId: a, clientId: null }, body('draft'), null),
    );
    const identity = await withTenant(app.db, a, (tx) =>
      publishedThemeRepository(tx).identity(a, foreign),
    );
    expect(identity).toEqual({ tenant: null, client: null });
  });

  it('finds nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const themes = themeRepository(tx);
        await themes.saveDraft({ tenantId, clientId: null }, body('z'), null);
        await themes.publish({ tenantId, clientId: null });
        return { tenantId };
      },
      verifySeeded: async (tx, seeded) => {
        expect(
          (await publishedThemeRepository(tx).identity(seeded.tenantId, null)).tenant,
        ).not.toBeNull();
      },
      attempt: (tx, seeded) => publishedThemeRepository(tx).identity(seeded.tenantId, null),
      expectBlocked: (result) => {
        expect(result).toEqual({ tenant: null, client: null });
      },
    });
  });
});
