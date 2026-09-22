import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { roles } from '#/schema/roles';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see clients.ts in @odudu/domain-tenant for why.
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  // Denormalized and maintained only by groupRepository: `/engineering` for
  // a root group, `/engineering/platform` for its child. Read, never
  // derived, so a group's ancestry is one column away rather than a
  // recursive walk.
  path: text('path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface GroupRecord {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: Date;
}

export const groupRoles = pgTable(
  'group_roles',
  {
    tenantId: uuid('tenant_id').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.roleId] })],
).enableRLS();

export const subjectGroups = pgTable(
  'subject_groups',
  {
    tenantId: uuid('tenant_id').notNull(),
    // References subjects(id), owned by @odudu/domain-identity. Plain
    // column for the same reason as roles.clientId in @odudu/domain-authz's
    // own roles schema.
    subjectId: uuid('subject_id').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.subjectId, table.groupId] })],
).enableRLS();
