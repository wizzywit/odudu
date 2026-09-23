import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  // The party recorded in the issued token's `act` claim, so introspection
  // can reproduce it without holding the token. Null for every grant that
  // is not a delegated exchange.
  actorSubjectId: uuid('actor_subject_id'),
  // The grant whose token was presented as `subject_token`. Lineage only:
  // nothing walks it yet, and revoking a parent does not revoke a child.
  exchangedFromGrantId: uuid('exchanged_from_grant_id'),
  // The `act` claim exactly as issued (RFC 8693 §4.4), so a refresh
  // rotation can reapply it to the replacement access token. Stored as the
  // full chain rather than rebuilt from `actorSubjectId` alone — a nested
  // delegation cannot be recovered from just its outermost actor. Null for
  // every grant that names no actor.
  actChain: jsonb('act_chain'),
  // The subject token's own `exp` at the moment of exchange, so a refresh
  // rotation can cap the replacement the same way `mintAccessToken`'s
  // `expCeiling` capped the token issued at exchange time. Null only for a
  // grant no exchange produced — every subject shape this server resolves
  // (access token, refresh token, id_token) carries its own expiry.
  expCeiling: timestamp('exp_ceiling', { withTimezone: true }),
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
  actorSubjectId: string | null;
  exchangedFromGrantId: string | null;
  // jsonb: an untyped boundary, the same as ClientOidcConfig's `jwks` —
  // narrowed with `narrowActClaim` (service/token-exchange.ts) at the
  // point of use, not typed here.
  actChain: unknown;
  expCeiling: Date | null;
}
