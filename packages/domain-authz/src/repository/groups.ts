import { type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { groupRoles, groups, subjectGroups, type GroupRecord } from '#/schema/groups';

export type { GroupRecord } from '#/schema/groups';

function toRecord(row: typeof groups.$inferSelect): GroupRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    name: row.name,
    path: row.path,
    createdAt: row.createdAt,
  };
}

export interface NewGroup {
  tenantId: string;
  name: string;
  parentId: string | null;
}

async function findById(tx: TenantScopedDatabase, groupId: string): Promise<GroupRecord | null> {
  const rows = await tx.select().from(groups).where(eq(groups.id, groupId));
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

async function requireById(tx: TenantScopedDatabase, groupId: string): Promise<GroupRecord> {
  const found = await findById(tx, groupId);
  if (found === null) {
    throw new OduduError('group_not_found', `no group with id ${groupId}`);
  }
  return found;
}

const idRowSchema = z.object({ id: z.string() });
const idRowsSchema = z.array(idRowSchema);

const pathRowSchema = z.object({ path: z.string() });
const pathRowsSchema = z.array(pathRowSchema);

// The groups a subject directly belongs to, not their ancestors — the
// ancestor walk that turns this into inherited membership lives in
// effectiveRoles' group_closure, not here. Why that is the right claim
// shape: docs/adr/0022-group-claims-carry-direct-memberships.md.
export async function effectiveGroupPaths(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<readonly string[]> {
  const result = await tx.execute(sql`
    SELECT g.path AS path
    FROM groups g
    JOIN subject_groups sg ON sg.group_id = g.id
    WHERE sg.subject_id = ${subjectId}
  `);
  return pathRowsSchema.parse(result).map((row) => row.path);
}

// Descendants reachable from `startId` by following parent_id edges
// downward (child -> parent points up, so this walks the reverse
// direction). UNION, not UNION ALL: the same termination reasoning as
// role_composites' closure — see docs/superpowers/p2a-spike-log.md. Exported
// only for groups.int.test.ts's cyclic-parent_id termination probe; the
// package's public surface (src/index.ts) does not re-export it.
export async function descendantsOf(
  tx: TenantScopedDatabase,
  startId: string,
): Promise<Set<string>> {
  const result = await tx.execute(sql`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM groups WHERE parent_id = ${startId}
      UNION
      SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id
    )
    SELECT id FROM descendants
  `);
  const rows = idRowsSchema.parse(result);
  return new Set(rows.map((row) => row.id));
}

export function groupRepository(tx: TenantScopedDatabase) {
  return {
    // `path` is this repository's only writer: a root group's path is
    // `/${name}`, and a child's path is its parent's path with `/${name}`
    // appended, computed here rather than trusted from the caller.
    async create(input: NewGroup): Promise<GroupRecord> {
      const path =
        input.parentId === null
          ? `/${input.name}`
          : `${(await requireById(tx, input.parentId)).path}/${input.name}`;

      const rows = await tx
        .insert(groups)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          parentId: input.parentId,
          name: input.name,
          path,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('insert_returned_no_row', 'insert into groups returned no row');
      }
      return toRecord(row);
    },

    async byPath(path: string): Promise<GroupRecord | null> {
      const rows = await tx.select().from(groups).where(eq(groups.path, path));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Moving a subtree changes every descendant's path, not just the moved
    // group's: `path` is denormalized, so leaving a descendant's stale is
    // an invariant violation `UNIQUE (tenant_id, path)` cannot detect.
    async reparent(groupId: string, newParentId: string | null): Promise<void> {
      const group = await requireById(tx, groupId);

      if (newParentId !== null) {
        const reachable = await descendantsOf(tx, groupId);
        if (newParentId === groupId || reachable.has(newParentId)) {
          throw new OduduError('group_reparent_cycle', 'would create a cycle');
        }
      }

      const newParentPath = newParentId === null ? '' : (await requireById(tx, newParentId)).path;
      const newOwnPath = `${newParentPath}/${group.name}`;
      const oldPath = group.path;

      await tx.update(groups).set({ parentId: newParentId }).where(eq(groups.id, groupId));

      // The position argument must be cast to an integer: an untyped
      // parameter here resolves to the two-argument, POSIX-regex overload
      // of substring() instead of the FROM/integer one, and silently
      // returns NULL when the "pattern" (the stringified number) has no
      // match, rather than a position offset.
      await tx.execute(sql`
        UPDATE groups
        SET path = ${newOwnPath} || substring(path FROM ${oldPath.length + 1}::int)
        WHERE path = ${oldPath} OR path LIKE ${`${oldPath}/%`}
      `);
    },

    // tenant_id is read back from the group being mapped or joined, the
    // same tenant RLS already scopes both it and the caller's other
    // argument to.
    async mapRole(groupId: string, roleId: string): Promise<void> {
      const group = await requireById(tx, groupId);
      await tx.insert(groupRoles).values({ tenantId: group.tenantId, groupId, roleId });
    },

    async addToSubject(subjectId: string, groupId: string): Promise<void> {
      const group = await requireById(tx, groupId);
      await tx.insert(subjectGroups).values({ tenantId: group.tenantId, subjectId, groupId });
    },
  };
}
