import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in drizzle/, never declared with pgPolicy():
// realms_isolation exists in every migrated database while
// meta/0002_snapshot.json records policies: {}, so generating DDL from this
// declaration emits a CREATE POLICY that fails 42710. The SQL is the
// schema's source of truth and this is a typed view of it
// (packages/db/README.md); rls-policy.int.test.ts stops a table shipping
// without a policy, schema-drift.int.test.ts stops the view drifting.
export const realms = pgTable('realms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // All three default off (packages/db/drizzle/0022_realm_account_settings.sql):
  // a realm does not acquire registration, mailed verification or
  // self-service password reset because it was upgraded.
  registrationAllowed: boolean('registration_allowed').notNull().default(false),
  verifyEmail: boolean('verify_email').notNull().default(false),
  resetPasswordAllowed: boolean('reset_password_allowed').notNull().default(false),
  // The idle clock and the hard ceiling an SSO session is issued with
  // (packages/db/drizzle/0028_realm_session_lifespans.sql); the idle value
  // is bounded by the ceiling at the database, not clamped at issuance.
  ssoSessionIdleSeconds: integer('sso_session_idle_seconds').notNull().default(1800),
  ssoSessionMaxSeconds: integer('sso_session_max_seconds').notNull().default(36_000),
  // The password policy every writer of a password in this realm is bound
  // by (packages/db/drizzle/0035_realm_password_policy.sql): a rule a
  // CHECK can bound at the database, not a default a writer could bypass.
  // See packages/domain-identity/src/service/password-policy.ts for how
  // these are turned into pass/fail decisions.
  passwordMinLength: integer('password_min_length').notNull().default(8),
  passwordRequireDigit: boolean('password_require_digit').notNull().default(false),
  passwordRequireUppercase: boolean('password_require_uppercase').notNull().default(false),
  passwordRequireLowercase: boolean('password_require_lowercase').notNull().default(false),
  passwordRequireSpecial: boolean('password_require_special').notNull().default(false),
  passwordNotUsername: boolean('password_not_username').notNull().default(true),
  passwordNotEmail: boolean('password_not_email').notNull().default(true),
  passwordHistoryDepth: integer('password_history_depth').notNull().default(0),
  passwordMaxAgeDays: integer('password_max_age_days').notNull().default(0),
}).enableRLS();
