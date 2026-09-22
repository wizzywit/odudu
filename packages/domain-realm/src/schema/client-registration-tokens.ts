import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts for why.
export const clientRegistrationTokens = pgTable('client_registration_tokens', {
  id: uuid('id').primaryKey(),
  realmId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  remainingUses: integer('remaining_uses').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}).enableRLS();

export interface ClientRegistrationTokenRecord {
  id: string;
  realmId: string;
  tokenHash: string;
  remainingUses: number;
  createdAt: Date;
  expiresAt: Date;
}
