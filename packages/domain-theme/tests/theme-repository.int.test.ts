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
import { assetRepository, type NewAsset } from '#/repository/assets';
import { themeRepository } from '#/repository/themes';
import { themeAssets } from '#/schema/theme-assets';
import { themeVersionAssets } from '#/schema/theme-version-assets';
import { themeVersions } from '#/schema/theme-versions';
import { MAX_STORED_ASSET_BYTES } from '#/service/asset-limits';
import { parseThemeBody, type ThemeBody } from '#/service/body';
import { type ThemeScope } from '#/service/record';

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
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function refusedByPolicy(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return cause instanceof Error && /row-level security/iu.test(cause.message);
}

function refusedByVersionIndex(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return cause instanceof Error && cause.message.includes('theme_versions_one_version');
}

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

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) => seedTenant(tx, tenantId));
  return tenantId;
}

function asset(tenantId: string, label: string, extra: Partial<NewAsset> = {}): NewAsset {
  return {
    tenantId,
    sha256: label.padEnd(64, '0'),
    mime: 'image/png',
    width: 4,
    height: 3,
    bytes: Buffer.from(label),
    tenantCapBytes: 1024,
    ...extra,
  };
}

async function publishedOnce(scope: ThemeScope, label: string): Promise<void> {
  await withTenant(app.db, scope.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const saved = await themes.saveDraft(
      scope,
      body(label),
      (await themes.draft(scope))?.etag ?? null,
    );
    if (saved === 'precondition_failed') throw new Error('unexpected precondition failure');
    await themes.publish(scope);
  });
}

describe('themeRepository', () => {
  it('keeps one draft per scope', async () => {
    const tenantId = await freshTenant();
    const clientId = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    const tenantScope = { tenantId, clientId: null };
    const clientScope = { tenantId, clientId };

    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const first = await themes.saveDraft(tenantScope, body('one'), null);
      if (first === 'precondition_failed') throw new Error('first save refused');
      const second = await themes.saveDraft(tenantScope, body('two'), first.etag);
      if (second === 'precondition_failed') throw new Error('second save refused');
      await themes.saveDraft(clientScope, body('client'), null);

      expect((await themes.draft(tenantScope))?.body).toEqual(body('two'));
      expect((await themes.draft(tenantScope))?.id).toBe(first.id);
      expect((await themes.draft(clientScope))?.body).toEqual(body('client'));
    });

    const rows = await owner.db
      .select({ id: themeVersions.id })
      .from(themeVersions)
      .where(eq(themeVersions.tenantId, tenantId));
    expect(rows).toHaveLength(2);
  });

  it('refuses a second draft for a scope at the index', async () => {
    const tenantId = await freshTenant();
    const insert = (): Promise<unknown> =>
      owner.db.insert(themeVersions).values({
        id: newId(),
        tenantId,
        clientId: null,
        state: 'draft',
        version: 0,
        body: body('x'),
      });
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('refuses a version number used twice in a scope at the index, whichever state holds it', async () => {
    const tenantId = await freshTenant();
    const insert = (state: 'published' | 'archived', version: number): Promise<unknown> =>
      owner.db.insert(themeVersions).values({
        id: newId(),
        tenantId,
        clientId: null,
        state,
        version,
        body: body('x'),
      });
    await insert('archived', 1);
    await expect(insert('archived', 1)).rejects.toSatisfy(refusedByVersionIndex);
    await expect(insert('published', 1)).rejects.toSatisfy(refusedByVersionIndex);
    await insert('published', 2);
  });

  it('publish archives the previous version', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await publishedOnce(scope, 'v2');

    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      expect((await themes.published(scope))?.body).toEqual(body('v2'));
      expect((await themes.published(scope))?.version).toBe(2);
      expect(await themes.draft(scope)).toBeNull();
      const versions = await themes.versions(scope, 10);
      expect(versions.map((v) => [v.version, v.state])).toEqual([
        [2, 'published'],
        [1, 'archived'],
      ]);
    });
  });

  it('refuses to publish when there is no draft', async () => {
    const tenantId = await freshTenant();
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        themeRepository(tx).publish({ tenantId, clientId: null }),
      ),
    ).rejects.toThrow(/no draft/u);
  });

  it('saveDraft with a stale etag returns precondition_failed', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const first = await themes.saveDraft(scope, body('one'), null);
      if (first === 'precondition_failed') throw new Error('first save refused');
      await themes.saveDraft(scope, body('two'), first.etag);

      expect(await themes.saveDraft(scope, body('three'), first.etag)).toBe('precondition_failed');
      expect(await themes.saveDraft(scope, body('three'), null)).toBe('precondition_failed');
      expect((await themes.draft(scope))?.body).toEqual(body('two'));
    });
  });

  it('prunes to 20 versions', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    for (let i = 1; i <= 25; i += 1) await publishedOnce(scope, `v${String(i)}`);

    await withTenant(app.db, tenantId, async (tx) => {
      const versions = await themeRepository(tx).versions(scope, 100);
      expect(versions).toHaveLength(20);
      expect(versions[0]?.version).toBe(25);
      expect(versions[19]?.version).toBe(6);
    });
  });

  it('restore publishes an earlier version as a new one', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await publishedOnce(scope, 'v2');

    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const first = (await themes.versions(scope, 10)).find((v) => v.version === 1);
      if (first === undefined) throw new Error('version 1 missing');
      const restored = await themes.restore(scope, first.id);
      expect(restored.state).toBe('published');
      expect(restored.version).toBe(3);
      expect(restored.body).toEqual(body('v1'));
      expect((await themes.published(scope))?.id).toBe(restored.id);
      expect((await themes.versions(scope, 10)).map((v) => v.state)).toEqual([
        'published',
        'archived',
        'archived',
      ]);
    });
  });

  it('restore refuses a version of another scope', async () => {
    const tenantId = await freshTenant();
    const clientId = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publishedOnce({ tenantId, clientId: null }, 'v1');
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const [tenantVersion] = await themes.versions({ tenantId, clientId: null }, 10);
      if (tenantVersion === undefined) throw new Error('no version');
      await expect(themes.restore({ tenantId, clientId }, tenantVersion.id)).rejects.toThrow(
        /version/u,
      );
    });
  });

  it('reset archives the published theme and drops the draft', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft(scope, body('draft'), null);
      await themes.reset(scope);
      expect(await themes.published(scope)).toBeNull();
      expect(await themes.draft(scope)).toBeNull();
      expect((await themes.versions(scope, 10)).map((v) => v.state)).toEqual(['archived']);
    });
  });

  it('deleting a client deletes its themes', async () => {
    const tenantId = await freshTenant();
    const clientId = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    await publishedOnce({ tenantId, clientId }, 'v1');
    await publishedOnce({ tenantId, clientId: null }, 'tenant');

    await withTenant(app.db, tenantId, (tx) => tx.delete(clients).where(eq(clients.id, clientId)));

    const rows = await owner.db
      .select({ clientId: themeVersions.clientId })
      .from(themeVersions)
      .where(eq(themeVersions.tenantId, tenantId));
    expect(rows).toEqual([{ clientId: null }]);
  });

  it('refuses a draft naming an asset id that is not a uuid and keeps the draft', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft(scope, body('kept'), null),
    );

    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        const themes = themeRepository(tx);
        const draft = await themes.draft(scope);
        return themes.saveDraft(scope, body('bad', 'not-a-uuid'), draft?.etag ?? null);
      }),
    ).rejects.toThrow();

    const draft = await withTenant(app.db, tenantId, (tx) => themeRepository(tx).draft(scope));
    expect(draft?.body).toEqual(body('kept'));
  });

  it('stores an asset named by two slots once', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    const assetId = newId();
    const twice: ThemeBody = {
      ...body('twice'),
      assets: { logo: { assetId, alt: 'logo' }, favicon: { assetId } },
    };
    await withTenant(app.db, tenantId, (tx) => themeRepository(tx).saveDraft(scope, twice, null));

    const rows = await owner.db
      .select()
      .from(themeVersionAssets)
      .where(eq(themeVersionAssets.tenantId, tenantId));
    expect(rows.map((row) => row.assetId)).toEqual([assetId]);
  });

  it('treats two spellings of one asset id as one', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    const assetId = newId();
    const parsed = parseThemeBody({
      assets: { logo: { assetId, alt: 'logo' }, favicon: { assetId: assetId.toUpperCase() } },
    });
    if (!parsed.ok) throw new Error('body refused');
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft(scope, parsed.body, null),
    );

    const rows = await owner.db
      .select()
      .from(themeVersionAssets)
      .where(eq(themeVersionAssets.tenantId, tenantId));
    expect(rows.map((row) => row.assetId)).toEqual([assetId]);
    const draft = await withTenant(app.db, tenantId, (tx) => themeRepository(tx).draft(scope));
    expect(draft?.body.assets.favicon?.assetId).toBe(assetId);
  });

  it('lists at most the limit, newest first, without the draft', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    for (let i = 1; i <= 5; i += 1) await publishedOnce(scope, `v${String(i)}`);
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft(scope, body('draft'), null);
      const versions = await themes.versions(scope, 3);
      expect(versions.map((v) => v.version)).toEqual([5, 4, 3]);
      expect(versions.every((v) => v.state !== 'draft')).toBe(true);
    });
  });

  it('restore leaves the draft untouched', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await publishedOnce(scope, 'v2');
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const saved = await themes.saveDraft(scope, body('draft'), null);
      if (saved === 'precondition_failed') throw new Error('refused');
      const [, older] = await themes.versions(scope, 10);
      if (older === undefined) throw new Error('no older version');
      await themes.restore(scope, older.id);
      const draft = await themes.draft(scope);
      expect(draft?.id).toBe(saved.id);
      expect(draft?.etag).toBe(saved.etag);
    });
  });

  it('removes a pruned version’s asset rows', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    const assetId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft(scope, body('v1', assetId), null);
      await themes.publish(scope);
    });
    const held = () =>
      owner.db.select().from(themeVersionAssets).where(eq(themeVersionAssets.tenantId, tenantId));
    expect(await held()).toHaveLength(1);
    for (let i = 2; i <= 21; i += 1) await publishedOnce(scope, `v${String(i)}`);
    expect(await held()).toEqual([]);
  });

  it('deleting a tenant deletes its themes, their asset rows and its assets', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await withTenant(app.db, tenantId, async (tx) => {
      const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
      if (stored === 'over_cap') throw new Error('refused');
      const themes = themeRepository(tx);
      await themes.saveDraft(scope, body('v1', stored.id), null);
      await themes.publish(scope);
    });

    await owner.db.delete(tenants).where(eq(tenants.id, tenantId));

    for (const table of [themeVersions, themeVersionAssets, themeAssets]) {
      expect(await owner.db.select().from(table).where(eq(table.tenantId, tenantId))).toEqual([]);
    }
  });

  it('lets one of two parallel first saves win and refuses the other', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    const save = (label: string) =>
      withTenant(app.db, tenantId, (tx) => themeRepository(tx).saveDraft(scope, body(label), null));

    const results = await Promise.all([save('a'), save('b')]);

    expect(results.filter((r) => r === 'precondition_failed')).toHaveLength(1);
    expect(results.filter((r) => r !== 'precondition_failed')).toHaveLength(1);
  });

  it('gives two parallel restores distinct, sequential versions', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await publishedOnce(scope, 'v2');
    const first = await withTenant(app.db, tenantId, async (tx) =>
      (await themeRepository(tx).versions(scope, 10)).find((v) => v.version === 1),
    );
    if (first === undefined) throw new Error('version 1 missing');
    const restore = () =>
      withTenant(app.db, tenantId, (tx) => themeRepository(tx).restore(scope, first.id));

    await Promise.all([restore(), restore()]);

    const versions = await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).versions(scope, 10),
    );
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions.filter((v) => v.state === 'published')).toHaveLength(1);
  });

  it('keeps one published row and no repeated version when a restore races a publish', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'v1');
    await publishedOnce(scope, 'v2');
    await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).saveDraft(scope, body('d'), null),
    );
    const first = await withTenant(app.db, tenantId, async (tx) =>
      (await themeRepository(tx).versions(scope, 10)).find((v) => v.version === 1),
    );
    if (first === undefined) throw new Error('version 1 missing');

    await Promise.all([
      withTenant(app.db, tenantId, (tx) => themeRepository(tx).restore(scope, first.id)),
      withTenant(app.db, tenantId, (tx) => themeRepository(tx).publish(scope)),
    ]);

    const versions = await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).versions(scope, 10),
    );
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions.filter((v) => v.state === 'published')).toHaveLength(1);
  });

  it('lists versions without their bodies, newest first and bounded', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    for (const label of ['one', 'two', 'three']) await publishedOnce(scope, label);

    const listed = await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).listVersions(scope, 2),
    );

    expect(listed.map((v) => [v.version, v.state])).toEqual([
      [3, 'published'],
      [2, 'archived'],
    ]);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'publishedAt',
      'state',
      'version',
    ]);
  });

  it('reads one version of the scope and no draft or other scope', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await publishedOnce(scope, 'one');
    const draft = await withTenant(app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft(scope, body('draft'), null);
      return themes.draft(scope);
    });
    const [published] = await withTenant(app.db, tenantId, (tx) =>
      themeRepository(tx).versions(scope, 5),
    );

    const read = (id: string): Promise<unknown> =>
      withTenant(app.db, tenantId, (tx) => themeRepository(tx).version(scope, id));

    expect(await read(published?.id ?? '')).toMatchObject({ version: 1, state: 'published' });
    expect(await read(draft?.id ?? '')).toBeNull();
    expect(await read(newId())).toBeNull();
  });

  it('holds only the tenant’s own images by id', async () => {
    const tenantId = await freshTenant();
    const other = await freshTenant();
    const mine = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).put(asset(tenantId, 'mine')),
    );
    const theirs = await withTenant(app.db, other, (tx) =>
      assetRepository(tx).put(asset(other, 'theirs')),
    );
    if (mine === 'over_cap' || theirs === 'over_cap') throw new Error('refused');

    const held = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).hold(tenantId, [mine.id, theirs.id, newId()]),
    );
    const none = await withTenant(app.db, tenantId, (tx) => assetRepository(tx).hold(tenantId, []));

    expect(held.map((a) => a.id)).toEqual([mine.id]);
    expect(none).toEqual([]);
  });

  describe('against another tenant', () => {
    const scopeOf = (tenantId: string): ThemeScope => ({ tenantId, clientId: null });

    it('draft finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          await themeRepository(tx).saveDraft(scopeOf(tenantId), body('x'), null);
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).draft(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, tenantId) => themeRepository(tx).draft(scopeOf(tenantId)),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('published finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          await themes.publish(scopeOf(tenantId));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).published(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, tenantId) => themeRepository(tx).published(scopeOf(tenantId)),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('lockDraft finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          await themeRepository(tx).saveDraft(scopeOf(tenantId), body('x'), null);
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).lockDraft(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, tenantId) => themeRepository(tx).lockDraft(scopeOf(tenantId)),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('listVersions lists nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          await themes.publish(scopeOf(tenantId));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).listVersions(scopeOf(tenantId), 20)).toHaveLength(1);
        },
        attempt: (tx, tenantId) => themeRepository(tx).listVersions(scopeOf(tenantId), 20),
        expectBlocked: (result) => {
          expect(result).toEqual([]);
        },
      });
    });

    it('version finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          const published = await themes.publish(scopeOf(tenantId));
          return { tenantId, versionId: published.id };
        },
        verifySeeded: async (tx, { tenantId, versionId }) => {
          expect(await themeRepository(tx).version(scopeOf(tenantId), versionId)).not.toBeNull();
        },
        attempt: (tx, { tenantId, versionId }) =>
          themeRepository(tx).version(scopeOf(tenantId), versionId),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('saveDraft is refused by the policy and leaves the draft alone', async () => {
      const tenantA = await freshTenant();
      const tenantB = await freshTenant();
      await withTenant(app.db, tenantA, (tx) =>
        themeRepository(tx).saveDraft(scopeOf(tenantA), body('mine'), null),
      );

      await expect(
        withTenant(app.db, tenantB, (tx) =>
          themeRepository(tx).saveDraft(scopeOf(tenantA), body('theirs'), null),
        ),
      ).rejects.toSatisfy(refusedByPolicy);

      const draft = await withTenant(app.db, tenantA, (tx) =>
        themeRepository(tx).draft(scopeOf(tenantA)),
      );
      expect(draft?.body).toEqual(body('mine'));
    });

    it('publish refuses', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          await themeRepository(tx).saveDraft(scopeOf(tenantId), body('x'), null);
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).draft(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, tenantId) =>
          themeRepository(tx)
            .publish(scopeOf(tenantId))
            .catch((error: unknown) => error),
        expectBlocked: (result) => {
          expect(result).toBeInstanceOf(Error);
        },
        verifyTenantAUnaffected: async (tx, tenantId) => {
          expect(await themeRepository(tx).draft(scopeOf(tenantId))).not.toBeNull();
          expect(await themeRepository(tx).published(scopeOf(tenantId))).toBeNull();
        },
      });
    });

    it('versions lists nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          await themes.publish(scopeOf(tenantId));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).versions(scopeOf(tenantId), 10)).toHaveLength(1);
        },
        attempt: (tx, tenantId) => themeRepository(tx).versions(scopeOf(tenantId), 10),
        expectBlocked: (result) => {
          expect(result).toEqual([]);
        },
      });
    });

    it('restore refuses', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          const published = await themes.publish(scopeOf(tenantId));
          return { tenantId, versionId: published.id };
        },
        verifySeeded: async (tx, { tenantId }) => {
          expect(await themeRepository(tx).published(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, { tenantId, versionId }) =>
          themeRepository(tx)
            .restore(scopeOf(tenantId), versionId)
            .catch((error: unknown) => error),
        expectBlocked: (result) => {
          expect(result).toBeInstanceOf(Error);
        },
        verifyTenantAUnaffected: async (tx, { tenantId }) => {
          expect((await themeRepository(tx).versions(scopeOf(tenantId), 10)).length).toBe(1);
        },
      });
    });

    it('reset leaves the other tenant’s themes', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const themes = themeRepository(tx);
          await themes.saveDraft(scopeOf(tenantId), body('x'), null);
          await themes.publish(scopeOf(tenantId));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await themeRepository(tx).published(scopeOf(tenantId))).not.toBeNull();
        },
        attempt: (tx, tenantId) => themeRepository(tx).reset(scopeOf(tenantId)),
        expectBlocked: () => undefined,
        verifyTenantAUnaffected: async (tx, tenantId) => {
          expect(await themeRepository(tx).published(scopeOf(tenantId))).not.toBeNull();
        },
      });
    });
  });
});

describe('assetRepository', () => {
  it('stores an asset once and reads its bytes back', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const assets = assetRepository(tx);
      const first = await assets.put(asset(tenantId, 'logo'));
      const again = await assets.put(asset(tenantId, 'logo'));
      if (first === 'over_cap' || again === 'over_cap') throw new Error('refused');
      expect(again.id).toBe(first.id);
      expect(first).toEqual({
        id: first.id,
        sha256: 'logo'.padEnd(64, '0'),
        mime: 'image/png',
        width: 4,
        height: 3,
      });
      const read = await assets.get(tenantId, first.sha256);
      expect(read?.bytes.toString()).toBe('logo');
      expect(await assets.bytesUsed(tenantId)).toBe(4);
    });
  });

  it('refuses an asset that would pass the tenant cap', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const assets = assetRepository(tx);
      expect(await assets.put(asset(tenantId, 'aaaa', { tenantCapBytes: 6 }))).not.toBe('over_cap');
      expect(await assets.put(asset(tenantId, 'bbbb', { tenantCapBytes: 6 }))).toBe('over_cap');
      expect(await assets.bytesUsed(tenantId)).toBe(4);
    });
  });

  it('counts the draft and published versions that name an asset', async () => {
    const tenantId = await freshTenant();
    const scope = { tenantId, clientId: null };
    await withTenant(app.db, tenantId, async (tx) => {
      const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
      if (stored === 'over_cap') throw new Error('refused');
      const themes = themeRepository(tx);
      expect(await assetRepository(tx).referencedBy(tenantId, stored.id)).toBe(0);
      await themes.saveDraft(scope, body('a', stored.id), null);
      expect(await assetRepository(tx).referencedBy(tenantId, stored.id)).toBe(1);
      await themes.publish(scope);
      const draft = await themes.saveDraft(scope, body('b', stored.id), null);
      if (draft === 'precondition_failed') throw new Error('refused');
      expect(await assetRepository(tx).referencedBy(tenantId, stored.id)).toBe(2);
      await themes.saveDraft(scope, body('c'), draft.etag);
      expect(await assetRepository(tx).referencedBy(tenantId, stored.id)).toBe(1);
    });
  });

  it('lists the draft and published versions that name an asset, bounded', async () => {
    const tenantId = await freshTenant();
    const clientId = await withTenant(app.db, tenantId, (tx) => seedClient(tx, tenantId));
    const tenantScope = { tenantId, clientId: null };
    const clientScope = { tenantId, clientId };
    await withTenant(app.db, tenantId, async (tx) => {
      const assets = assetRepository(tx);
      const stored = await assets.put(asset(tenantId, 'logo'));
      if (stored === 'over_cap') throw new Error('refused');
      const themes = themeRepository(tx);
      expect(await assets.references(tenantId, stored.id, 10)).toEqual([]);
      await themes.saveDraft(tenantScope, body('a', stored.id), null);
      await themes.publish(tenantScope);
      await themes.saveDraft(tenantScope, body('b', stored.id), null);
      await themes.saveDraft(clientScope, body('c', stored.id), null);
      await themes.publish(clientScope);
      await themes.publish(tenantScope);
      const found = await assets.references(tenantId, stored.id, 10);
      expect(found.map((r) => [r.clientId, r.state]).sort()).toEqual(
        [
          [null, 'published'],
          [clientId, 'published'],
        ].sort(),
      );
      expect(await assets.references(tenantId, stored.id, 1)).toHaveLength(1);
    });
  });

  it('locks an asset the tenant holds and nothing else', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const assets = assetRepository(tx);
      const stored = await assets.put(asset(tenantId, 'logo'));
      if (stored === 'over_cap') throw new Error('refused');
      expect(await assets.lock(tenantId, stored.id)).toEqual(stored);
      expect(await assets.lock(tenantId, newId())).toBeNull();
    });
  });

  it('reads a tenant total above 2^31 bytes', async () => {
    const tenantId = await freshTenant();
    await owner.sql.unsafe(`
      insert into theme_assets (id, tenant_id, sha256, mime, width, height, bytes)
      select gen_random_uuid(), '${tenantId}', md5(g::text) || md5('a' || g), 'image/png', 1, 1,
             decode(repeat('00', 1048576), 'hex')
        from generate_series(1, 2100) g`);
    const used = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).bytesUsed(tenantId),
    );
    expect(used).toBe(2100 * 1048576);
  }, 120_000);

  it('delete removes the asset', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const assets = assetRepository(tx);
      const stored = await assets.put(asset(tenantId, 'logo'));
      if (stored === 'over_cap') throw new Error('refused');
      await assets.delete(tenantId, stored.id);
      expect(await assets.get(tenantId, stored.sha256)).toBeNull();
    });
  });

  describe('content', () => {
    it('reads one image by id, published or not, with its stored type', async () => {
      const tenantId = await freshTenant();
      await withTenant(app.db, tenantId, async (tx) => {
        const assets = assetRepository(tx);
        const stored = await assets.put(asset(tenantId, 'logo', { mime: 'image/webp' }));
        if (stored === 'over_cap') throw new Error('refused');
        const read = await assets.content(tenantId, stored.id);
        expect(read?.mime).toBe('image/webp');
        expect(read?.bytes.toString()).toBe('logo');
      });
    });

    // A value that is not an id never reaches the repository: the admin route
    // refuses it with 400 from its path parameters.
    it('finds nothing for an id that is unknown', async () => {
      const tenantId = await freshTenant();
      await withTenant(app.db, tenantId, async (tx) => {
        expect(await assetRepository(tx).content(tenantId, newId())).toBeNull();
      });
    });

    it('does not return a row stored over the size an upload can produce', async () => {
      const tenantId = await freshTenant();
      const id = newId();
      await owner.db.insert(themeAssets).values({
        id,
        tenantId,
        sha256: 'big'.padEnd(64, '0'),
        mime: 'image/png',
        width: 1,
        height: 1,
        bytes: Buffer.alloc(MAX_STORED_ASSET_BYTES + 1),
      });
      await withTenant(app.db, tenantId, async (tx) => {
        expect(await assetRepository(tx).content(tenantId, id)).toBeNull();
      });
    });
  });

  describe('against another tenant', () => {
    it('content finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId, assetId }) => {
          expect(await assetRepository(tx).content(tenantId, assetId)).not.toBeNull();
        },
        attempt: (tx, { tenantId, assetId }) => assetRepository(tx).content(tenantId, assetId),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('get finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          await assetRepository(tx).put(asset(tenantId, 'logo'));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await assetRepository(tx).get(tenantId, 'logo'.padEnd(64, '0'))).not.toBeNull();
        },
        attempt: (tx, tenantId) => assetRepository(tx).get(tenantId, 'logo'.padEnd(64, '0')),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('put is refused by the policy and stores nothing', async () => {
      const tenantA = await freshTenant();
      const tenantB = await freshTenant();

      await expect(
        withTenant(app.db, tenantB, (tx) => assetRepository(tx).put(asset(tenantA, 'logo'))),
      ).rejects.toSatisfy(refusedByPolicy);

      const used = await withTenant(app.db, tenantA, (tx) =>
        assetRepository(tx).bytesUsed(tenantA),
      );
      expect(used).toBe(0);
    });

    it('referencedBy counts nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          await themeRepository(tx).saveDraft(
            { tenantId, clientId: null },
            body('x', stored.id),
            null,
          );
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId, assetId }) => {
          expect(await assetRepository(tx).referencedBy(tenantId, assetId)).toBe(1);
        },
        attempt: (tx, { tenantId, assetId }) => assetRepository(tx).referencedBy(tenantId, assetId),
        expectBlocked: (result) => {
          expect(result).toBe(0);
        },
      });
    });

    it('references lists nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          await themeRepository(tx).saveDraft(
            { tenantId, clientId: null },
            body('x', stored.id),
            null,
          );
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId, assetId }) => {
          expect(await assetRepository(tx).references(tenantId, assetId, 5)).toHaveLength(1);
        },
        attempt: (tx, { tenantId, assetId }) =>
          assetRepository(tx).references(tenantId, assetId, 5),
        expectBlocked: (result) => {
          expect(result).toEqual([]);
        },
      });
    });

    it('lock finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId, assetId }) => {
          expect(await assetRepository(tx).lock(tenantId, assetId)).not.toBeNull();
        },
        attempt: (tx, { tenantId, assetId }) => assetRepository(tx).lock(tenantId, assetId),
        expectBlocked: (result) => {
          expect(result).toBeNull();
        },
      });
    });

    it('delete removes nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId }) => {
          expect(await assetRepository(tx).bytesUsed(tenantId)).toBe(4);
        },
        attempt: (tx, { tenantId, assetId }) => assetRepository(tx).delete(tenantId, assetId),
        expectBlocked: () => undefined,
        verifyTenantAUnaffected: async (tx, { tenantId }) => {
          expect(await assetRepository(tx).bytesUsed(tenantId)).toBe(4);
        },
      });
    });

    it('hold finds nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const stored = await assetRepository(tx).put(asset(tenantId, 'logo'));
          if (stored === 'over_cap') throw new Error('refused');
          return { tenantId, assetId: stored.id };
        },
        verifySeeded: async (tx, { tenantId, assetId }) => {
          expect(await assetRepository(tx).hold(tenantId, [assetId])).toHaveLength(1);
        },
        attempt: (tx, { tenantId, assetId }) => assetRepository(tx).hold(tenantId, [assetId]),
        expectBlocked: (result) => {
          expect(result).toEqual([]);
        },
      });
    });

    it('bytesUsed counts nothing', async () => {
      await expectCrossTenantMethodProbe(app.db, {
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          await assetRepository(tx).put(asset(tenantId, 'logo'));
          return tenantId;
        },
        verifySeeded: async (tx, tenantId) => {
          expect(await assetRepository(tx).bytesUsed(tenantId)).toBe(4);
        },
        attempt: (tx, tenantId) => assetRepository(tx).bytesUsed(tenantId),
        expectBlocked: (result) => {
          expect(result).toBe(0);
        },
      });
    });
  });
});
