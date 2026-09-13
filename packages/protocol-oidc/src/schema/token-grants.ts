import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// One row per redemption of an authorization code (and, later, per
// client_credentials issuance): the record a refresh token or a revocation
// call points back at. `token_grants_realm_id_unique` on (realm_id, id)
// exists so the refresh-token table can carry a composite foreign key.
export const tokenGrants = pgTable('token_grants', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  scope: text('scope').notNull(),
  audience: text('audience').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}).enableRLS();

export interface TokenGrantRecord {
  id: string;
  realmId: string;
  clientId: string;
  subjectId: string;
  scope: string;
  audience: string[];
  createdAt: Date;
  revokedAt: Date | null;
}
