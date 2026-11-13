import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// What a tenant-level requirement can name. "This tenant requires OTP" can
// only ever mean one of these being pending for a subject — see
// #/usecase/required-actions.ts for the order they run in.
export type RequiredAction =
  | 'verify-email'
  | 'update-password'
  | 'configure-totp'
  | 'configure-passkey'
  | 'generate-recovery-codes'
  | 'update-profile'
  | 'accept-terms';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why.
export const userRequiredActions = pgTable(
  'user_required_actions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull(),
    action: text('action').$type<RequiredAction>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subjectId, table.action] })],
).enableRLS();
