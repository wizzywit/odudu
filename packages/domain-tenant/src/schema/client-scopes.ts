import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { clients } from '#/schema/clients';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts for why.
export const clientScopes = pgTable('client_scopes', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  includeInIdToken: boolean('include_in_id_token').notNull().default(true),
  // Symmetric with includeInIdToken, and the same default — the column's
  // own default is not what keeps authorization claims (roles, groups) off
  // the ID token and identity claims (name, email) off the access token;
  // provision-defaults.ts seeds those per scope. A scope created later with
  // no explicit flags lands in both tokens. Added in migration 0019, after
  // include_in_id_token (0016) shipped without it.
  includeInAccessToken: boolean('include_in_access_token').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Lives beside the table, not in the repository, so that `service` can
// reference the shape of a scope without depending on the repository that
// reads it. Deliberately carries no list of claim mappers: a mapper still
// declares the scopes it reads (packages/protocol-oidc/src/service/claims.ts),
// but a tenant may override which of them a scope actually reaches — see
// `client_scope_mappers` (client-scope-mappers.ts), the per-tenant binding
// table that carries the override, keyed by scope rather than by tenant.
export interface ClientScopeRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  includeInIdToken: boolean;
  includeInAccessToken: boolean;
  createdAt: Date;
}

export type ClientScopeAssignment = 'default' | 'optional';

export const clientScopeAssignments = pgTable(
  'client_scope_assignments',
  {
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientScopeId: uuid('client_scope_id')
      .notNull()
      .references(() => clientScopes.id, { onDelete: 'cascade' }),
    assignment: text('assignment').$type<ClientScopeAssignment>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.clientScopeId] })],
).enableRLS();
