import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// The four actions a realm-level requirement can name. "This realm requires
// OTP" can only ever mean one of these being pending for a subject — see
// #/usecase/required-actions.ts for the order they run in.
export type RequiredAction =
  'update-password' | 'configure-totp' | 'configure-passkey' | 'generate-recovery-codes';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why.
export const userRequiredActions = pgTable(
  'user_required_actions',
  {
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull(),
    action: text('action').$type<RequiredAction>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.realmId, table.subjectId, table.action] })],
).enableRLS();
