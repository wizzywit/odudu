import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

export type DomainState = 'pending' | 'verified' | 'failed';

// Policy, the CHECKs on the host's shape and on `canonical`, and the partial
// unique indexes are in packages/db/drizzle/0111_tenant_domains.sql.
export const tenantDomains = pgTable('tenant_domains', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  state: text('state').$type<DomainState>().notNull().default('pending'),
  challenge: text('challenge').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  failedChecks: integer('failed_checks').notNull().default(0),
  canonical: boolean('canonical').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const tenantIssuerRetirements = pgTable(
  'tenant_issuer_retirements',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.issuer] })],
).enableRLS();
