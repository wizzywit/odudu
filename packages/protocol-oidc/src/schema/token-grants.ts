import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// One row per redemption of an authorization code (and, later, per
// client_credentials issuance): the record a refresh token or a revocation
// call points back at. `token_grants_tenant_id_unique` on (tenant_id, id)
// exists so the refresh-token table can carry a composite foreign key.
export const tokenGrants = pgTable('token_grants', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  scope: text('scope').notNull(),
  audience: text('audience').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Null means an offline grant: nothing expires it and no logout ends it.
  // The composite foreign key to sessions(tenant_id, id) and its ON DELETE
  // SET NULL live only in packages/db/drizzle/0026_token_grants_session.sql
  // — see this file's own note above on why FKs are hand-authored here.
  sessionId: uuid('session_id'),
}).enableRLS();

export interface TokenGrantRecord {
  id: string;
  tenantId: string;
  clientId: string;
  subjectId: string;
  scope: string;
  audience: string[];
  createdAt: Date;
  revokedAt: Date | null;
  sessionId: string | null;
}
