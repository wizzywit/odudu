import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';
import { type ClaimsRequest } from '#/service/claims-request';

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
  // The session the login that minted this code established, copied
  // forward so the grant created on redemption can carry it too. Null for
  // a code that will become an offline grant, and for any code that
  // predates this column. No foreign key — see migration 0029: a code
  // redeemed after its session has been reaped must still redeem.
  sessionId: uuid('session_id'),
  // The audience `parseResource` resolved at /authorize, against the
  // client's registered list — stored so /token derives `aud` from what
  // was approved rather than re-deriving it. `[]` has exactly one
  // meaning: the resolved audience is empty, so `aud` is the issuer
  // alone — never "unset" or "not carried". Every code-minting path sets
  // this from the same resolution, whether the request completes
  // immediately or after a login detour — see migration 0053.
  resource: text('resource').array().notNull().default([]),
  // The `claims` request parameter (OIDC Core §5.5), resolved once at
  // /authorize and stored as JSON text rather than jsonb — /token and
  // /userinfo only ever read the whole value back, never query into it.
  // Every code-minting path sets this, `{}` members included; see
  // migration 0056.
  claims: text('claims').notNull().default('{"idToken":{},"userinfo":{}}'),
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
  sessionId: string | null;
  resource: readonly string[];
  claims: ClaimsRequest;
}
