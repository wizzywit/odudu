import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// tenant_id is denormalized so this table's isolation policy needs no join to
// subjects; the composite foreign key back to subjects(tenant_id, id) — see
// packages/db/drizzle/0006_sessions.sql — is what stops the two disagreeing.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  // What actually authenticated this login, in the order it ran — set once,
  // at establishment, and never rewritten. `amr`/`acr` read this rather
  // than the subject's enrolled credentials, so a login is described by
  // what it used, not by what it could have used.
  authenticators: text('authenticators').array().notNull().default([]),
  // Whether this login asked to be remembered: selects which lifespan pair
  // the session is measured against and which cookie carries its id
  // (packages/db/drizzle/0048_sessions_remembered_and_cap.sql).
  remembered: boolean('remembered').notNull().default(false),
  // sha256 hex of the secret half of this session's cookie entry; null only
  // on a row that predates it, which is never live
  // (packages/db/drizzle/0071_session_secret.sql).
  secretHash: text('secret_hash'),
}).enableRLS();

export interface SessionRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
  authenticators: string[];
  remembered: boolean;
}
