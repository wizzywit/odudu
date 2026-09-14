import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts in @odudu/domain-realm for why.
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  // References clients(id), owned by @odudu/domain-realm. Declared as a
  // plain column: the foreign key lives only in the hand-authored
  // migration, so this package never imports the clients table.
  clientId: uuid('client_id'),
  name: text('name').notNull(),
  description: text('description'),
  defaultForNewSubjects: boolean('default_for_new_subjects').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Lives beside the table, not in the repository, so that `service` can
// reference the shape of a role without depending on the repository that
// reads it. `clientId` null means a realm role; non-null means a role
// scoped to that client, qualified by qualifiedRoleName.
export interface RoleRecord {
  id: string;
  realmId: string;
  clientId: string | null;
  name: string;
  description: string | null;
  defaultForNewSubjects: boolean;
  createdAt: Date;
}

export const roleComposites = pgTable(
  'role_composites',
  {
    realmId: uuid('realm_id').notNull(),
    parentRoleId: uuid('parent_role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    childRoleId: uuid('child_role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.parentRoleId, table.childRoleId] })],
).enableRLS();

export const subjectRoles = pgTable(
  'subject_roles',
  {
    realmId: uuid('realm_id').notNull(),
    // References subjects(id), owned by @odudu/domain-identity. Plain
    // column for the same reason as roles.clientId above.
    subjectId: uuid('subject_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.subjectId, table.roleId] })],
).enableRLS();

export const clientScopeRoles = pgTable(
  'client_scope_roles',
  {
    realmId: uuid('realm_id').notNull(),
    // References client_scopes(id), owned by @odudu/domain-realm. Plain
    // column for the same reason as roles.clientId above.
    clientScopeId: uuid('client_scope_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.clientScopeId, table.roleId] })],
).enableRLS();
