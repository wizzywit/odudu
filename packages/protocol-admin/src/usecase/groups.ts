import { type Group } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { groupRepository, groups, roles } from '@odudu/domain-authz';
import { OduduError } from '@odudu/kernel';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_GROUP_FIELDS, refusalFor } from '#/service/group-patch';
import { type RoleAssignment } from '#/usecase/subjects';

const COLLECTION = 'groups';

export interface GroupAuditEvent {
  readonly action: 'group.create' | 'group.amend' | 'group.delete' | 'group.roles_set';
  readonly resourceType: 'group';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: GroupAuditEvent) => Promise<void>;

export function groupWireShape(group: {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  createdAt: Date;
}): Group {
  return {
    id: group.id,
    name: group.name,
    parent_id: group.parentId,
    path: group.path,
    created_at: group.createdAt.toISOString(),
  };
}

export interface ListGroupsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
}

export type ListGroupsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly Group[]; next: string | null };

export async function listGroups(
  tx: TenantScopedDatabase,
  input: ListGroupsInput,
): Promise<ListGroupsOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await tx
    .select()
    .from(groups)
    .where(after === undefined ? undefined : gt(groups.id, after))
    .orderBy(asc(groups.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map(groupWireShape);
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: COLLECTION,
          tenantId: input.tenantId,
        })
      : null;

  return { kind: 'ok', items, next };
}

export type ReadGroupOutcome = { kind: 'not_found' } | { kind: 'ok'; group: Group };

export async function readGroup(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<ReadGroupOutcome> {
  const group = await groupRepository(tx).byId(groupId);
  return group === null ? { kind: 'not_found' } : { kind: 'ok', group: groupWireShape(group) };
}

export interface CreateGroupInput {
  readonly tenantId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly actorSubjectId: string;
}

export interface CreateGroupDeps {
  readonly audit: Audit;
}

// `OduduError('group_not_found')` from `groupRepository.create` (a
// `parent_id` naming no group) propagates out of this function instead of
// appearing in a returned outcome — caught by the route the same way
// `ClientIdConflictError` is caught outside `withTenant` in
// `createClientHandler` (#/view/routes/clients.ts).
export async function createGroup(
  tx: TenantScopedDatabase,
  deps: CreateGroupDeps,
  input: CreateGroupInput,
): Promise<Group> {
  const created = await groupRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    parentId: input.parentId,
  });

  await deps.audit({
    action: 'group.create',
    resourceType: 'group',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
  });

  return groupWireShape(created);
}

export interface AmendGroupInput {
  readonly groupId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
}

export interface AmendGroupDeps {
  readonly audit: Audit;
}

export type AmendGroupOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | { kind: 'cycle' }
  | { kind: 'ok'; group: Group; etag: string };

async function lockGroupForAmend(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<typeof groups.$inferSelect | null> {
  const rows = await tx.select().from(groups).where(eq(groups.id, groupId)).for('update');
  return rows[0] ?? null;
}

/** `parent_id` is the only amendable field: reparenting, via `groupRepository.reparent`. */
export async function amendGroup(
  tx: TenantScopedDatabase,
  deps: AmendGroupDeps,
  input: AmendGroupInput,
): Promise<AmendGroupOutcome> {
  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_GROUP_FIELDS.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field) ?? `${field} is not a group field`,
      };
    }
  }

  const locked = await lockGroupForAmend(tx, input.groupId);
  if (locked === null) return { kind: 'not_found' };

  const currentEtag = etagOf(groupWireShape(locked));
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  let parentId: string | null | undefined;
  if ('parent_id' in input.values) {
    const value = input.values.parent_id;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'parent_id',
        description: 'parent_id must be a string or null',
      };
    }
    parentId = value;
  }

  if (parentId !== undefined) {
    try {
      await groupRepository(tx).reparent(input.groupId, parentId);
    } catch (error) {
      if (error instanceof OduduError && error.code === 'group_reparent_cycle') {
        return { kind: 'cycle' };
      }
      throw error;
    }
  }

  await deps.audit({
    action: 'group.amend',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
  });

  const after = await readGroup(tx, input.groupId);
  if (after.kind !== 'ok') {
    throw new Error(`group ${input.groupId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', group: after.group, etag: etagOf(after.group) };
}

export interface DeleteGroupInput {
  readonly groupId: string;
  readonly actorSubjectId: string;
}

export interface DeleteGroupDeps {
  readonly audit: Audit;
}

export type DeleteGroupOutcome = { kind: 'not_found' } | { kind: 'deleted' };

export async function deleteGroup(
  tx: TenantScopedDatabase,
  deps: DeleteGroupDeps,
  input: DeleteGroupInput,
): Promise<DeleteGroupOutcome> {
  const deleted = await groupRepository(tx).delete(input.groupId);
  if (!deleted) return { kind: 'not_found' };

  await deps.audit({
    action: 'group.delete',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
  });
  return { kind: 'deleted' };
}

export interface SetGroupRolesInput {
  readonly groupId: string;
  readonly roleIds: readonly string[];
  readonly actorSubjectId: string;
}

export interface SetGroupRolesDeps {
  readonly audit: Audit;
}

export type SetGroupRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'ok'; roles: readonly RoleAssignment[] };

/** Replaces the role set a group maps to wholesale — a role left out is one the caller clears. */
export async function setGroupRoles(
  tx: TenantScopedDatabase,
  deps: SetGroupRolesDeps,
  input: SetGroupRolesInput,
): Promise<SetGroupRolesOutcome> {
  const group = await groupRepository(tx).byId(input.groupId);
  if (group === null) return { kind: 'not_found' };

  const uniqueRoleIds = [...new Set(input.roleIds)];
  const found =
    uniqueRoleIds.length === 0
      ? []
      : await tx
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(inArray(roles.id, uniqueRoleIds));
  const foundIds = new Set(found.map((role) => role.id));
  const missing = uniqueRoleIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { kind: 'unknown_role', roleIds: missing };
  }

  await groupRepository(tx).setRoles(input.groupId, uniqueRoleIds);

  await deps.audit({
    action: 'group.roles_set',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ok', roles: found };
}
