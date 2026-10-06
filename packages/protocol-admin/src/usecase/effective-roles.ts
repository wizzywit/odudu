import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  compositesWithin,
  effectiveRolePage,
  heldAmong,
  roles,
  subjectRoles,
} from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clients, TENANT_ADMIN } from '@odudu/domain-tenant';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

const COLLECTION = 'effective-roles';

// The roles of the built-in admin client a subject is judged by: Full and each capability.
const HOLDINGS: readonly string[] = [TENANT_ADMIN, ...ADMIN_CAPABILITIES];

export type ListEffectiveRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly EffectiveRoleAssignment[]; next: string | null };

const groupEdgeRowsSchema = z.array(
  z.object({ role_id: z.string(), group_id: z.string(), group_path: z.string() }),
);

// The groups a subject belongs to and every ancestor of each, with those of
// `roleIds` mapped to them: `effectiveRoles`' own `group_closure`, keeping the group.
async function groupEdges(tx: TenantScopedDatabase, subjectId: string, roleIds: readonly string[]) {
  const wanted = sql.join(
    roleIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return groupEdgeRowsSchema.parse(
    await tx.execute(sql`
      WITH RECURSIVE group_closure AS (
        SELECT g.id, g.parent_id
        FROM subject_groups sg
        CROSS JOIN LATERAL (
          SELECT id, parent_id FROM groups WHERE id = sg.group_id OFFSET 0
        ) g
        WHERE sg.subject_id = ${subjectId}
        UNION
        SELECT p.id, p.parent_id
        FROM group_closure c
        CROSS JOIN LATERAL (
          SELECT id, parent_id FROM groups WHERE id = c.parent_id OFFSET 0
        ) p
      )
      SELECT gr.role_id, g.id AS group_id, g.path AS group_path
      FROM group_closure gc
      CROSS JOIN LATERAL (
        SELECT role_id FROM group_roles WHERE group_id = gc.id AND role_id IN (${wanted}) OFFSET 0
      ) gr
      CROSS JOIN LATERAL (SELECT id, path FROM groups WHERE id = gc.id OFFSET 0) g
      ORDER BY g.path, gr.role_id
    `),
  );
}

export interface ListEffectiveRolesInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

// The roles of `heldIds`, which the subject holds, each with the paths it is
// held by: assigned, mapped to a group of its own or an ancestor's, nested
// under another role it holds.
export async function heldRolesWithPaths(
  tx: TenantScopedDatabase,
  subjectId: string,
  heldIds: readonly string[],
) {
  const rows = await tx
    .select({
      id: roles.id,
      name: roles.name,
      client_id: roles.clientId,
      client_key: clients.clientId,
    })
    .from(roles)
    .leftJoin(clients, eq(clients.id, roles.clientId))
    .where(inArray(roles.id, [...heldIds]))
    .orderBy(asc(roles.id));

  const via = new Map<string, RoleProvenance[]>(heldIds.map((id) => [id, []]));
  const direct = await tx
    .select({ roleId: subjectRoles.roleId })
    .from(subjectRoles)
    .where(and(eq(subjectRoles.subjectId, subjectId), inArray(subjectRoles.roleId, [...heldIds])));
  for (const row of direct) via.get(row.roleId)?.push({ kind: 'direct' });
  for (const edge of await groupEdges(tx, subjectId, heldIds)) {
    via.get(edge.role_id)?.push({
      kind: 'group',
      group_id: edge.group_id,
      group_path: edge.group_path,
    });
  }
  for (const edge of await compositesWithin(tx, subjectId, heldIds)) {
    via.get(edge.childRoleId)?.push({
      kind: 'composite',
      parent_role_id: edge.parentRoleId,
      parent_name: edge.parentName,
    });
  }
  return { rows, via };
}

// Which roles a subject holds is `effectiveRoles`' answer, the one issuance
// and authorization both read; this adds only how each was reached. Every
// edge named is one inside that set, so a path never names a role the
// subject does not hold. A page of the set, in role id order, and the
// provenance of the roles on it alone.
export async function listEffectiveRoles(
  tx: TenantScopedDatabase,
  input: ListEffectiveRolesInput,
): Promise<ListEffectiveRolesOutcome> {
  const subjectId = input.subjectId;
  if ((await subjectRepository(tx).byId(subjectId)) === null) return { kind: 'not_found' };

  const filters = filterDigest({ subject: subjectId });
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const found = await effectiveRolePage(tx, subjectId, { after, limit: input.limit + 1 });
  const hasMore = found.length > input.limit;
  const held = hasMore ? found.slice(0, input.limit) : found;
  const heldIds = held.map((role) => role.roleId);
  if (heldIds.length === 0) return { kind: 'ok', items: [], next: null };

  const { rows, via } = await heldRolesWithPaths(tx, subjectId, heldIds);

  const last = held[held.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.roleId,
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;
  return {
    kind: 'ok',
    items: rows.map((row) => ({ ...row, via: via.get(row.id) ?? [] })),
    next,
  };
}

export type AdminCapabilitiesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; items: readonly EffectiveRoleAssignment[] };

// What the console judges a subject by: the admin capabilities it holds, found
// among the few roles the built-in admin client defines instead of in the whole
// effective set, which can be more than a page of roles. Sized by the model.
export async function listAdminCapabilities(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<AdminCapabilitiesOutcome> {
  if ((await subjectRepository(tx).byId(subjectId)) === null) return { kind: 'not_found' };
  const candidates = await tx
    .select({ id: roles.id })
    .from(roles)
    .innerJoin(clients, eq(clients.id, roles.clientId))
    .where(and(eq(clients.clientId, ADMIN_CLIENT_ID), inArray(roles.name, [...HOLDINGS])));
  const held = await heldAmong(
    tx,
    subjectId,
    candidates.map((role) => role.id),
  );
  if (held.size === 0) return { kind: 'ok', items: [] };
  const { rows, via } = await heldRolesWithPaths(tx, subjectId, [...held]);
  return { kind: 'ok', items: rows.map((row) => ({ ...row, via: via.get(row.id) ?? [] })) };
}
