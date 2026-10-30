import { pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { themeVersions } from '#/schema/theme-versions';

// Policy and the index by asset are in packages/db/drizzle/0107_themes.sql.
export const themeVersionAssets = pgTable(
  'theme_version_assets',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => themeVersions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.assetId] })],
).enableRLS();
