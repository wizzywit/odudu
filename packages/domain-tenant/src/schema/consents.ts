import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { clientScopes } from '#/schema/client-scopes';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts for why. The composite foreign keys to
// subjects(tenant_id, id) and clients(tenant_id, id) live only in the
// migration: drizzle's table builder has no way to declare them here.
export const consents = pgTable('consents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull(),
  clientId: uuid('client_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface ConsentRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  clientId: string;
  createdAt: Date;
  updatedAt: Date;
}

// One row per granted scope, so withdrawing one is a delete rather than a
// rewrite of the set. Deleting a tenant scope withdraws every consent to it
// (client_scopes' ON DELETE CASCADE into here): a grant to a scope that no
// longer exists grants nothing.
export const consentScopes = pgTable(
  'consent_scopes',
  {
    tenantId: uuid('tenant_id').notNull(),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => consents.id, { onDelete: 'cascade' }),
    clientScopeId: uuid('client_scope_id')
      .notNull()
      .references(() => clientScopes.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.consentId, table.clientScopeId] })],
).enableRLS();

export interface ConsentScopeRecord {
  tenantId: string;
  consentId: string;
  clientScopeId: string;
  grantedAt: Date;
}
