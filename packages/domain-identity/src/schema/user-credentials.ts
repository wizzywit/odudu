import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subjects } from '#/schema/subjects';
import { type CredentialSecret, type CredentialType } from '#/service/credential-secret';

export { type CredentialType } from '#/service/credential-secret';

// A typed row per credential, not a password_hash column on users. Multiple
// credentials of different types per subject — password, TOTP, passkey,
// recovery codes — would be impossible to express in fixed columns.
export const userCredentials = pgTable('user_credentials', {
  id: uuid('id').primaryKey(),
  realmId: uuid('tenant_id').notNull(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  type: text('type').$type<CredentialType>().notNull(),
  // Parsed at the repository boundary (#/service/credential-secret), never
  // read or written as `any` — jsonb is exactly the untyped boundary that
  // exists for.
  secretData: jsonb('secret_data').notNull(),
  label: text('label'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  // A WebAuthn credential id. Unique per realm (migration 0034) so a
  // passwordless assertion, which names a credential rather than a user,
  // can resolve its subject through an index instead of scanning jsonb.
  lookupKey: text('lookup_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface CredentialRecord {
  id: string;
  realmId: string;
  subjectId: string;
  type: CredentialType;
  secret: CredentialSecret;
  label: string | null;
  lastUsedAt: Date | null;
  lookupKey: string | null;
  createdAt: Date;
}
