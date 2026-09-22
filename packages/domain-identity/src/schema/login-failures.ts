import { integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

// One row per subject who has failed a password attempt, created by the
// first failure and deleted by the next success (see
// packages/db/drizzle/0041_login_failures.sql). Keyed by subject rather
// than by the username submitted: a counter keyed by a name would let an
// attacker lock an account out through a name it no longer answers to, and
// would miss one arriving by email.
export const loginFailures = pgTable(
  'login_failures',
  {
    tenantId: uuid('tenant_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    // The start of the run of failures the count belongs to, reset when a
    // quiet period breaks the run. Nothing in the lockout arithmetic reads
    // it — the quiet period is measured from the most recent failure — so
    // it is here for whoever is asked how long an account has been under
    // attack.
    firstFailureAt: timestamp('first_failure_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subjectId] })],
).enableRLS();
