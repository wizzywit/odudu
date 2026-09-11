import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
export const signingKeys = pgTable('signing_keys', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  kid: text('kid').notNull(),
  alg: text('alg').notNull(),
  status: text('status').notNull(),
  publicJwk: jsonb('public_jwk').notNull(),
  privateJwkEncrypted: text('private_jwk_encrypted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  notAfter: timestamp('not_after', { withTimezone: true }),
}).enableRLS();
