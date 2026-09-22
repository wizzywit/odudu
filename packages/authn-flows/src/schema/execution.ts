import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

export type Requirement = 'required' | 'alternative' | 'conditional' | 'disabled';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why.
//
// One flat, ordered list per realm: consecutive ALTERNATIVE executions form
// a group ("passkey or password") without a tree walker, and CONDITIONAL
// executions decide their own applicability. `index` carries the order, so
// it is data (unique with realm_id), not an accident of insertion.
export const authenticationExecutions = pgTable('authentication_executions', {
  id: uuid('id').primaryKey(),
  realmId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  authenticator: text('authenticator').notNull(),
  requirement: text('requirement').$type<Requirement>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface AuthenticationExecutionRecord {
  id: string;
  realmId: string;
  index: number;
  authenticator: string;
  requirement: Requirement;
}
