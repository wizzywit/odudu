import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { effectiveRoles, roleComposites, roles, subjectRoles } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

export type ListEffectiveRolesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; items: readonly EffectiveRoleAssignment[] };

const groupEdgeRowsSchema = z.array(
  z.object({ role_id: z.string(), group_id: z.string(), group_path: z.string() }),
);

// The groups a subject belongs to and every ancestor of each, with the roles
// mapped to them: `effectiveRoles`' own `group_closure`, keeping the group.
async function groupEdges(tx: TenantScopedDatabase, subjectId: string) {
  return groupEdgeRowsSchema.parse(
    await tx.execute(sql`
      WITH RECURSIVE group_closure AS (
        SELECT g.id, g.parent_id FROM groups g
        JOIN subject_groups sg ON sg.group_id = g.id
        WHERE sg.subject_id = ${subjectId}
        UNION
        SELECT p.id, p.parent_id FROM groups p JOIN group_closure c ON p.id = c.parent_id
      )
      SELECT gr.role_id, g.id AS group_id, g.path AS group_path
      FROM group_roles gr
      JOIN group_closure gc ON gc.id = gr.group_id
      JOIN groups g ON g.id = gc.id
      ORDER BY g.path, gr.role_id
    `),
  );
}

// Which roles a subject holds is `effectiveRoles`' answer, the one issuance
// and authorization both read; this adds only how each was reached. Every
// edge named is one inside that set, so a path never names a role the
// subject does not hold.
export async function listEffectiveRoles(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ListEffectiveRolesOutcome> {
  if ((await subjectRepository(tx).byId(subjectId)) === null) return { kind: 'not_found' };

  const held = await effectiveRoles(tx, subjectId);
  const heldIds = [...new Set(held.map((role) => role.roleId))];
  if (heldIds.length === 0) return { kind: 'ok', items: [] };

  const rows = await tx
    .select({
      id: roles.id,
      name: roles.name,
      client_id: roles.clientId,
      client_key: clients.clientId,
    })
    .from(roles)
    .leftJoin(clients, eq(clients.id, roles.clientId))
    .where(inArray(roles.id, heldIds))
    .orderBy(asc(roles.id));
  const names = new Map(rows.map((row) => [row.id, row.name]));

  const via = new Map<string, RoleProvenance[]>(heldIds.map((id) => [id, []]));
  const direct = await tx
    .select({ roleId: subjectRoles.roleId })
    .from(subjectRoles)
    .where(eq(subjectRoles.subjectId, subjectId));
  for (const row of direct) via.get(row.roleId)?.push({ kind: 'direct' });
  for (const edge of await groupEdges(tx, subjectId)) {
    via.get(edge.role_id)?.push({
      kind: 'group',
      group_id: edge.group_id,
      group_path: edge.group_path,
    });
  }
  const nested = await tx
    .select({ parent: roleComposites.parentRoleId, child: roleComposites.childRoleId })
    .from(roleComposites)
    .where(
      and(
        inArray(roleComposites.parentRoleId, heldIds),
        inArray(roleComposites.childRoleId, heldIds),
      ),
    )
    .orderBy(asc(roleComposites.parentRoleId));
  for (const edge of nested) {
    via.get(edge.child)?.push({
      kind: 'composite',
      parent_role_id: edge.parent,
      parent_name: names.get(edge.parent) ?? '',
    });
  }

  return {
    kind: 'ok',
    items: rows.map((row) => ({ ...row, via: via.get(row.id) ?? [] })),
  };
}
