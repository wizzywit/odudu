import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
export const clients = pgTable('clients', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  type: text('type').notNull(),
  secretHash: text('secret_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Lives beside the table, not in the repository, so that `service` (which
// may depend on no other layer) can reference the shape of a client without
// depending on the repository that reads it. Deliberately has no
// redirect_uris, grant_types or token_endpoint_auth_method: those are OAuth
// vocabulary and live in protocol-oidc's client_oidc_config (Task 11).
export interface ClientRecord {
  id: string;
  realmId: string;
  clientId: string;
  name: string;
  enabled: boolean;
  type: 'public' | 'confidential';
  secretHash: string | null;
  createdAt: Date;
}
