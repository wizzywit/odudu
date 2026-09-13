import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// The primary key is the hash, not the token itself, exactly like
// authorization_codes: the raw token is never stored, so nothing recovered
// from a backup or a log is redeemable. `grantId` is the family a reuse
// revokes as one statement — see refresh_tokens_by_grant in the migration.
export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  grantId: uuid('grant_id').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  // Bookkeeping only — which token replaced this one, once rotated.
  // Nothing in the rotation decision reads it back.
  replacedBy: text('replaced_by'),
}).enableRLS();

export interface RefreshTokenRecord {
  tokenHash: string;
  realmId: string;
  grantId: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  replacedBy: string | null;
}
