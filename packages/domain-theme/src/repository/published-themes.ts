import { type TenantScopedDatabase } from '@odudu/db';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { themeVersions } from '#/schema/theme-versions';
import { type PublishedAsset, type PublishedLayer, type PublishedLayers } from '#/service/record';

// Which published versions a scope resolves to, without their bodies.
export interface PublishedIdentity {
  tenant: { versionId: string; version: number } | null;
  client: { versionId: string; version: number; clientId: string } | null;
}

export function publishedThemeRepository(tx: TenantScopedDatabase) {
  function scope(tenantId: string, ownClient: SQL | undefined): SQL | undefined {
    return and(
      eq(themeVersions.tenantId, tenantId),
      eq(themeVersions.state, 'published'),
      ownClient === undefined
        ? isNull(themeVersions.clientId)
        : or(isNull(themeVersions.clientId), ownClient),
    );
  }

  // The outer table is named in the text: drizzle drops the qualifier from a
  // column of a single-table select, which would bind to the inner tables.
  async function read(tenantId: string, ownClient: SQL | undefined): Promise<PublishedLayers> {
    const assets = sql<PublishedAsset[]>`(
        select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'sha256', a.sha256, 'mime', a.mime, 'width', a.width, 'height', a.height)), '[]'::jsonb)
          from theme_version_assets va
          join theme_assets a on a.id = va.asset_id and a.tenant_id = va.tenant_id
         where va.version_id = theme_versions.id and va.tenant_id = ${tenantId})`;
    const rows = await tx
      .select({
        id: themeVersions.id,
        clientId: themeVersions.clientId,
        version: themeVersions.version,
        body: themeVersions.body,
        assets,
      })
      .from(themeVersions)
      .where(scope(tenantId, ownClient));
    const layer = (row: (typeof rows)[number] | undefined): PublishedLayer | null =>
      row === undefined
        ? null
        : {
            versionId: row.id,
            clientId: row.clientId,
            version: row.version,
            body: row.body,
            assets: row.assets,
          };
    return {
      tenant: layer(rows.find((row) => row.clientId === null)),
      client: layer(rows.find((row) => row.clientId !== null)),
    };
  }

  return {
    // The tenant's and the client's published rows and the images they
    // name, in one statement served by the scope index and the asset keys.
    // `oauthClientId` is the OAuth client_id a page knows; an id that names
    // no client of the tenant selects no client row, exactly as a client
    // with no theme does.
    // `enabledOnly` also leaves out the client of a disabled client, for a
    // mail, which must not wear the look of a client that is switched off.
    forRender(
      tenantId: string,
      oauthClientId: string | null,
      options: { enabledOnly?: boolean } = {},
    ): Promise<PublishedLayers> {
      const gate = options.enabledOnly === true ? sql` and c.enabled` : sql``;
      return read(
        tenantId,
        oauthClientId === null
          ? undefined
          : eq(
              themeVersions.clientId,
              sql`(select c.id from clients c where c.tenant_id = ${tenantId} and c.client_id = ${oauthClientId}${gate})`,
            ),
      );
    },

    // The same layers by the client's row id, which a hashed stylesheet's
    // URL carries. A row id of another tenant's client selects no row here.
    // Only which versions those are: two small rows from the same index, no
    // body and no images, for a caller that may not need either.
    async identity(tenantId: string, clientRowId: string | null): Promise<PublishedIdentity> {
      const rows = await tx
        .select({
          id: themeVersions.id,
          clientId: themeVersions.clientId,
          version: themeVersions.version,
        })
        .from(themeVersions)
        .where(
          scope(
            tenantId,
            clientRowId === null ? undefined : eq(themeVersions.clientId, clientRowId),
          ),
        );
      const tenant = rows.find((row) => row.clientId === null);
      const client = rows.find((row) => row.clientId !== null);
      return {
        tenant: tenant === undefined ? null : { versionId: tenant.id, version: tenant.version },
        client:
          client?.clientId == null
            ? null
            : { versionId: client.id, version: client.version, clientId: client.clientId },
      };
    },

    forStylesheet(tenantId: string, clientRowId: string | null): Promise<PublishedLayers> {
      return read(
        tenantId,
        clientRowId === null ? undefined : eq(themeVersions.clientId, clientRowId),
      );
    },
  };
}
