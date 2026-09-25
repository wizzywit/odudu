import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { clientScopes } from '#/schema/client-scopes';

// A row binds a registered claim mapper (the catalogue of mapper *types*
// stays code-defined, in `standardClaimMappers`) to one tenant's scope.
// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts for why.
export const clientScopeMappers = pgTable(
  'client_scope_mappers',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientScopeId: uuid('client_scope_id')
      .notNull()
      .references(() => clientScopes.id, { onDelete: 'cascade' }),
    mapperName: text('mapper_name').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.clientScopeId, table.mapperName] })],
).enableRLS();
