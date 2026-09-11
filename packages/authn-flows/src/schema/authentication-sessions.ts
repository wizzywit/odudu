import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why.
export const authenticationSessions = pgTable('authentication_sessions', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  pendingRequest: jsonb('pending_request').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}).enableRLS();

// The bytes validated at /authorize are the bytes bound to the code later
// issued: parking the whole request (rather than re-deriving it from form
// fields) is what stops scope or redirect_uri being edited in between.
export interface PendingRequest {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export interface AuthenticationSessionRecord {
  id: string;
  realmId: string;
  pendingRequest: PendingRequest;
  createdAt: Date;
  expiresAt: Date;
}
