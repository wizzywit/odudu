import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { themeAssets } from '#/schema/theme-assets';
import { themeVersionAssets } from '#/schema/theme-version-assets';
import { themeVersions } from '#/schema/theme-versions';
import { MAX_STORED_ASSET_BYTES } from '#/service/asset-limits';
import { type AssetRecord, type AssetRef, type ThemeState } from '#/service/record';

export interface NewAsset {
  tenantId: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  bytes: Buffer;
  // What the tenant's stored images, this one included, may total.
  tenantCapBytes: number;
}

export interface AssetReference {
  versionId: string;
  version: number;
  state: ThemeState;
  // The client's row id; null for the tenant's own theme.
  clientId: string | null;
}

const REF = {
  id: themeAssets.id,
  sha256: themeAssets.sha256,
  mime: themeAssets.mime,
  width: themeAssets.width,
  height: themeAssets.height,
};

export function assetRepository(tx: TenantScopedDatabase) {
  async function bytesUsed(tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ used: sql<number>`coalesce(sum(octet_length(${themeAssets.bytes})), 0)::float8` })
      .from(themeAssets)
      .where(eq(themeAssets.tenantId, tenantId));
    return row?.used ?? 0;
  }

  return {
    // Storing an image the tenant already holds returns the stored one and
    // counts nothing against the cap.
    async put(asset: NewAsset): Promise<AssetRef | 'over_cap'> {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${asset.tenantId}, 0))`);
      // Shared, like `hold`, so a delete cannot remove the image just returned.
      const [held] = await tx
        .select(REF)
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, asset.tenantId), eq(themeAssets.sha256, asset.sha256)))
        .for('share');
      if (held !== undefined) return held;
      if ((await bytesUsed(asset.tenantId)) + asset.bytes.length > asset.tenantCapBytes) {
        return 'over_cap';
      }
      const [stored] = await tx
        .insert(themeAssets)
        .values({
          id: newId(),
          tenantId: asset.tenantId,
          sha256: asset.sha256,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
          bytes: asset.bytes,
        })
        .returning(REF);
      if (stored === undefined) throw new Error('asset insert returned no row');
      return stored;
    },

    // The images of the tenant among `ids`, locked against deletion until the
    // transaction ends: a theme that names one is saved or published knowing
    // it exists. An id of another tenant or of nothing is simply absent.
    async hold(tenantId: string, ids: string[]): Promise<AssetRef[]> {
      if (ids.length === 0) return [];
      return tx
        .select(REF)
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), inArray(themeAssets.id, ids)))
        .for('share');
    },

    // The only read of an image's bytes.
    async get(tenantId: string, sha256: string): Promise<AssetRecord | null> {
      const [row] = await tx
        .select()
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), eq(themeAssets.sha256, sha256)));
      if (row === undefined) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        sha256: row.sha256,
        mime: row.mime,
        width: row.width,
        height: row.height,
        bytes: row.bytes,
      };
    },

    // One of the tenant's images by id, published or not, for an admin who
    // looks at what they uploaded. A row over MAX_STORED_ASSET_BYTES, which no
    // upload makes, is not read.
    async content(
      tenantId: string,
      assetId: string,
    ): Promise<{ mime: string; bytes: Buffer } | null> {
      const [row] = await tx
        .select({ mime: themeAssets.mime, bytes: themeAssets.bytes })
        .from(themeAssets)
        .where(
          and(
            eq(themeAssets.tenantId, tenantId),
            eq(themeAssets.id, assetId),
            sql`octet_length(${themeAssets.bytes}) <= ${MAX_STORED_ASSET_BYTES}`,
          ),
        );
      return row ?? null;
    },

    // The image a published version of the tenant names, by its hash: what a
    // public URL may serve. A draft's or archived version's image, another
    // tenant's and a deleted one select nothing. One indexed lookup through
    // the content key and the asset key, however many versions name it.
    async getPublished(
      tenantId: string,
      sha256: string,
    ): Promise<{ mime: string; bytes: Buffer } | null> {
      const [row] = await tx
        .select({ mime: themeAssets.mime, bytes: themeAssets.bytes })
        .from(themeAssets)
        .innerJoin(
          themeVersionAssets,
          and(
            eq(themeVersionAssets.assetId, themeAssets.id),
            eq(themeVersionAssets.tenantId, themeAssets.tenantId),
          ),
        )
        .innerJoin(themeVersions, eq(themeVersions.id, themeVersionAssets.versionId))
        .where(
          and(
            eq(themeAssets.tenantId, tenantId),
            eq(themeAssets.sha256, sha256),
            eq(themeVersions.tenantId, tenantId),
            eq(themeVersions.state, 'published'),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    // Whether `getPublished` would answer, and its type, without the bytes:
    // what a conditional request needs to be told 304.
    async publishedMime(tenantId: string, sha256: string): Promise<string | null> {
      const [row] = await tx
        .select({ mime: themeAssets.mime })
        .from(themeAssets)
        .innerJoin(
          themeVersionAssets,
          and(
            eq(themeVersionAssets.assetId, themeAssets.id),
            eq(themeVersionAssets.tenantId, themeAssets.tenantId),
          ),
        )
        .innerJoin(themeVersions, eq(themeVersions.id, themeVersionAssets.versionId))
        .where(
          and(
            eq(themeAssets.tenantId, tenantId),
            eq(themeAssets.sha256, sha256),
            eq(themeVersions.tenantId, tenantId),
            eq(themeVersions.state, 'published'),
          ),
        )
        .limit(1);
      return row?.mime ?? null;
    },

    // The tenant's images among `ids`, each with its stored size and no
    // bytes: what a preview weighs before it reads any. Not locked; a preview
    // writes nothing that a deletion could orphan.
    async sizes(
      tenantId: string,
      ids: string[],
    ): Promise<
      { id: string; sha256: string; mime: string; width: number; height: number; size: number }[]
    > {
      if (ids.length === 0) return [];
      return tx
        .select({
          id: themeAssets.id,
          sha256: themeAssets.sha256,
          mime: themeAssets.mime,
          width: themeAssets.width,
          height: themeAssets.height,
          size: sql<number>`octet_length(${themeAssets.bytes})::int`,
        })
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), inArray(themeAssets.id, ids)));
    },

    // The bytes of the tenant's images among `ids`, whoever's theme names them.
    async bytesOf(
      tenantId: string,
      ids: string[],
    ): Promise<{ id: string; mime: string; bytes: Buffer }[]> {
      if (ids.length === 0) return [];
      return tx
        .select({ id: themeAssets.id, mime: themeAssets.mime, bytes: themeAssets.bytes })
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), inArray(themeAssets.id, ids)));
    },

    // Drafts and published versions that name the asset in a slot; archived
    // versions are not counted.
    async referencedBy(tenantId: string, assetId: string): Promise<number> {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(themeVersionAssets)
        .innerJoin(themeVersions, eq(themeVersions.id, themeVersionAssets.versionId))
        .where(
          and(
            eq(themeVersionAssets.tenantId, tenantId),
            eq(themeVersionAssets.assetId, assetId),
            inArray(themeVersions.state, ['draft', 'published']),
          ),
        );
      return row?.count ?? 0;
    },

    // The draft and published versions that name the asset, which scope each
    // belongs to, at most `limit` of them: a list to show a person, where
    // `referencedBy` only counts. A btree lookup through
    // theme_version_assets_by_asset, however many versions name it.
    async references(tenantId: string, assetId: string, limit: number): Promise<AssetReference[]> {
      return tx
        .select({
          versionId: themeVersions.id,
          version: themeVersions.version,
          state: themeVersions.state,
          clientId: themeVersions.clientId,
        })
        .from(themeVersionAssets)
        .innerJoin(themeVersions, eq(themeVersions.id, themeVersionAssets.versionId))
        .where(
          and(
            eq(themeVersionAssets.tenantId, tenantId),
            eq(themeVersionAssets.assetId, assetId),
            eq(themeVersions.tenantId, tenantId),
            inArray(themeVersions.state, ['draft', 'published']),
          ),
        )
        .orderBy(themeVersions.clientId, themeVersions.state, themeVersions.id)
        .limit(limit);
    },

    // The asset, locked against a concurrent save that names it: `hold` takes
    // the shared lock this one conflicts with, so a delete decides on the
    // references that exist once the save has committed or fails the save.
    async lock(tenantId: string, assetId: string): Promise<AssetRef | null> {
      const [row] = await tx
        .select(REF)
        .from(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), eq(themeAssets.id, assetId)))
        .for('update');
      return row ?? null;
    },

    async delete(tenantId: string, assetId: string): Promise<void> {
      await tx
        .delete(themeAssets)
        .where(and(eq(themeAssets.tenantId, tenantId), eq(themeAssets.id, assetId)));
    },

    bytesUsed,
  };
}
