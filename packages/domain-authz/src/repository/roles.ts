import { type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  clientScopeRoles,
  roleComposites,
  roles,
  subjectRoles,
  type RoleRecord,
} from '#/schema/roles';

export type { RoleRecord } from '#/schema/roles';

function toRecord(row: typeof roles.$inferSelect): RoleRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    clientId: row.clientId,
    name: row.name,
    description: row.description,
    defaultForNewSubjects: row.defaultForNewSubjects,
    createdAt: row.createdAt,
  };
}

export interface NewRole {
  tenantId: string;
  name: string;
  clientId?: string | null;
  description?: string | null;
  defaultForNewSubjects?: boolean;
}

async function tenantOfRole(tx: TenantScopedDatabase, roleId: string): Promise<string> {
  const rows = await tx
    .select({ tenantId: roles.tenantId })
    .from(roles)
    .where(eq(roles.id, roleId));
  const row = rows[0];
  if (row === undefined) {
    throw new OduduError('role_not_found', `no role with id ${roleId}`);
  }
  return row.tenantId;
}

// tx.execute() returns driver rows as unknown structure; parsing narrows
// the actual shape instead of asserting one onto it — the same idiom
// effectiveRoles (#/repository/effective-roles.ts) uses for the same
// reason: a renamed or retyped column fails loudly here rather than
// flowing through as a malformed row.
const closureRowSchema = z.object({ role_id: z.string() });
const closureRowsSchema = z.array(closureRowSchema);

// Descendants reachable from `startId` by following role_composites edges
// (parent includes child) transitively. UNION, not UNION ALL: verified
// against PostgreSQL 17 to terminate on a cyclic graph, where the identical
// query with UNION ALL was cancelled by a statement timeout — see
// docs/superpowers/p2a-spike-log.md.
async function closureFrom(tx: TenantScopedDatabase, startId: string): Promise<Set<string>> {
  const result = await tx.execute(sql`
    WITH RECURSIVE closure(role_id) AS (
      SELECT child_role_id AS role_id FROM role_composites WHERE parent_role_id = ${startId}
      UNION
      SELECT rc.child_role_id AS role_id
        FROM role_composites rc
        JOIN closure c ON rc.parent_role_id = c.role_id
    )
    SELECT role_id FROM closure
  `);
  return new Set(closureRowsSchema.parse(result).map((row) => row.role_id));
}

export function roleRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewRole): Promise<RoleRecord> {
      const rows = await tx
        .insert(roles)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          clientId: input.clientId ?? null,
          name: input.name,
          description: input.description ?? null,
          defaultForNewSubjects: input.defaultForNewSubjects ?? false,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('insert_returned_no_row', 'insert into roles returned no row');
      }
      return toRecord(row);
    },

    async byName(name: string, clientId: string | null): Promise<RoleRecord | null> {
      const clientPredicate =
        clientId === null ? isNull(roles.clientId) : eq(roles.clientId, clientId);
      const rows = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.name, name), clientPredicate));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // The CHECK constraint refuses only self-reference. A longer cycle is
    // refused here: if the child already reaches the parent, adding this
    // edge closes a loop. The resolving query survives one anyway (it
    // unions), but a graph nobody can read back is not worth storing.
    async addComposite(parentRoleId: string, childRoleId: string): Promise<void> {
      const reachable = await closureFrom(tx, childRoleId);
      if (reachable.has(parentRoleId)) {
        throw new OduduError('role_composite_cycle', 'would create a cycle');
      }
      const tenantId = await tenantOfRole(tx, parentRoleId);
      await tx.insert(roleComposites).values({ tenantId, parentRoleId, childRoleId });
    },

    // tenant_id is not a caller-supplied argument: it is read back from the
    // role being assigned, the same tenant RLS already scopes both the role
    // and the subject to.
    async assignToSubject(subjectId: string, roleId: string): Promise<void> {
      const tenantId = await tenantOfRole(tx, roleId);
      await tx.insert(subjectRoles).values({ tenantId, subjectId, roleId });
    },

    async mapToClientScope(clientScopeId: string, roleId: string): Promise<void> {
      const tenantId = await tenantOfRole(tx, roleId);
      await tx.insert(clientScopeRoles).values({ tenantId, clientScopeId, roleId });
    },

    async defaultsForTenant(): Promise<RoleRecord[]> {
      const rows = await tx.select().from(roles).where(eq(roles.defaultForNewSubjects, true));
      return rows.map(toRecord);
    },

    // The role ids a set of client scopes reaches, read fresh per token
    // issuance so a mapping edited between requests takes effect on the
    // next one rather than the next login.
    async idsForClientScopes(clientScopeIds: readonly string[]): Promise<Set<string>> {
      if (clientScopeIds.length === 0) return new Set();
      const rows = await tx
        .select({ roleId: clientScopeRoles.roleId })
        .from(clientScopeRoles)
        .where(inArray(clientScopeRoles.clientScopeId, [...clientScopeIds]));
      return new Set(rows.map((row) => row.roleId));
    },
  };
}
