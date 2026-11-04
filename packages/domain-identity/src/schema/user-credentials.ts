import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subjects } from '#/schema/subjects';
import { type CredentialSecret, type CredentialType } from '#/service/credential-secret';

export { type CredentialType } from '#/service/credential-secret';

// A typed row per credential, not a password_hash column on users. Multiple
// credentials of different types per subject — password, TOTP, passkey,
// recovery codes — would be impossible to express in fixed columns.
export const userCredentials = pgTable('user_credentials', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  type: text('type').$type<CredentialType>().notNull(),
  // Parsed at the repository boundary (#/service/credential-secret), never
  // read or written as `any` — jsonb is exactly the untyped boundary that
  // exists for.
  secretData: jsonb('secret_data').notNull(),
  // Password rows only: true when the hash was made from the NFC form, null
  // for one made before passwords were normalised (migration 0103).
  hashNfc: boolean('hash_nfc'),
  label: text('label'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  // A WebAuthn credential id. Unique per tenant (migration 0034) so a
  // passwordless assertion, which names a credential rather than a user,
  // can resolve its subject through an index instead of scanning jsonb.
  lookupKey: text('lookup_key'),
  // The relying-party id a passkey was registered under; a passkey with none
  // yet is read as the base host's until boot stamps it
  // (packages/db/drizzle/0111_tenant_domains.sql).
  rpId: text('rp_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface CredentialRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  type: CredentialType;
  secret: CredentialSecret;
  label: string | null;
  lastUsedAt: Date | null;
  lookupKey: string | null;
  rpId: string | null;
  createdAt: Date;
}
