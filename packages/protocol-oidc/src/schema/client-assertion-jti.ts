import { realms } from '@odudu/db';
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see @odudu/db's realms.ts for why. oauth_client_id
// carries no foreign key: see 0054_client_assertion_jti.sql for what it
// names and why.
export const clientAssertionJti = pgTable(
  'client_assertion_jti',
  {
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'cascade' }),
    oauthClientId: text('oauth_client_id').notNull(),
    jti: text('jti').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.realmId, table.oauthClientId, table.jti] })],
).enableRLS();
