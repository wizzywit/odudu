import { realms } from '@odudu/db';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
export const backchannelLogoutDeliveries = pgTable('backchannel_logout_deliveries', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  endpoint: text('endpoint').notNull(),
  // Stored rather than minted at send time: it is signed at the moment the
  // session ended, so its iat and exp date from that event, not from
  // whichever retry happens to send it.
  logoutToken: text('logout_token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
}).enableRLS();

export interface LogoutDelivery {
  readonly id: string;
  readonly realmId: string;
  readonly clientId: string;
  readonly endpoint: string;
  readonly logoutToken: string;
  readonly attempts: number;
}
