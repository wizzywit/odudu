import { tenants } from '@odudu/db';
import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

// One row per tenant: `tenant_id` is the primary key, not a `uuid('id')`
// surrogate — a tenant has at most one SMTP configuration, the same
// singleton shape `tenant_settings` uses. `password_encrypted` wraps
// through the same envelope a signing key's private half does
// (`wrapSecret`/`unwrapSecret`, @odudu/crypto) — never a plaintext column.
// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see @odudu/db's tenants.ts for why.
export const tenantSmtp = pgTable('tenant_smtp', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  fromAddress: text('from_address').notNull(),
  username: text('username'),
  passwordEncrypted: text('password_encrypted'),
  starttls: boolean('starttls').notNull(),
}).enableRLS();
