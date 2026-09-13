import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// The primary key is the hash, not the code itself: the raw code is never
// stored, so a backup, a log, or a SQL injection elsewhere yields nothing
// redeemable.
export const authorizationCodes = pgTable('authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  nonce: text('nonce'),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull(),
  authTime: timestamp('auth_time', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Filled in during redemption, once the grant row exists — left null
  // (and without a foreign key; see the migration) until then.
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  grantId: uuid('grant_id'),
}).enableRLS();

// Every value the token endpoint must check the redemption against
// (client_id, subject_id, redirect_uri, scope, nonce, code_challenge and
// its method, auth_time), plus the bookkeeping fields redemption itself
// owns (expiresAt, consumedAt, grantId).
export interface AuthorizationCodeRecord {
  codeHash: string;
  realmId: string;
  clientId: string;
  subjectId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authTime: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  grantId: string | null;
}
