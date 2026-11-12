import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

// Global to the server and read from inside any tenant's context; see
// packages/db/drizzle/0135_breached_passwords.sql for the policy and why the
// five-and-thirty split of a published hash is no more sensitive than the
// corpus it came from.
export const breachedPasswordHashes = pgTable(
  'breached_password_hashes',
  {
    prefix: text('prefix').notNull(),
    suffix: text('suffix').notNull(),
  },
  (table) => [primaryKey({ columns: [table.prefix, table.suffix] })],
).enableRLS();
