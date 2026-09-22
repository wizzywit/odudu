import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
export const clients = pgTable('clients', {
  id: uuid('id').primaryKey(),
  realmId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  type: text('type').notNull(),
  secretHash: text('secret_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Nullable: a public client has no service account. Populated for
  // confidential clients when the client is provisioned, and read by the
  // client_credentials grant, whose issued token's `sub` is this subject.
  // Added in domain-identity's migration (0005), not here, because subjects
  // does not exist until that migration runs.
  serviceSubjectId: uuid('service_subject_id'),
  // Bypasses the client-scope-to-role intersection: every role the subject
  // holds, unfiltered, without a mapping. Added in domain-authz's migration
  // (0017), not here, because there are no roles to intersect until that
  // one runs.
  fullScopeAllowed: boolean('full_scope_allowed').notNull().default(false),
  // How this client came to exist (clients_registration_origin_check):
  // 'seeded' by an operator, 'token' by a registration token, 'anonymous'
  // by RFC 7591 open registration. Defaults 'seeded' so an existing client
  // is unchanged.
  registrationOrigin: text('registration_origin').notNull().default('seeded'),
}).enableRLS();

// Lives beside the table, not in the repository, so that `service` (which
// may depend on no other layer) can reference the shape of a client without
// depending on the repository that reads it. Deliberately has no
// redirect_uris, grant_types or token_endpoint_auth_method: those are OAuth
// vocabulary and live in protocol-oidc's client_oidc_config.
export interface ClientRecord {
  id: string;
  realmId: string;
  clientId: string;
  name: string;
  enabled: boolean;
  type: 'public' | 'confidential';
  secretHash: string | null;
  createdAt: Date;
  serviceSubjectId: string | null;
  fullScopeAllowed: boolean;
  registrationOrigin: 'seeded' | 'anonymous' | 'token';
}
