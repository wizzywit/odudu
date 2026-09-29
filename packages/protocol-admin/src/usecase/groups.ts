import { type Group, type ListGroupsQuery } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { groupRepository, groupRoles, groups, roles } from '@odudu/domain-authz';
import { clients } from '@odudu/domain-tenant';
import { isUuid, OduduError } from '@odudu/kernel';
import { and, asc, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  capabilitiesOfGroupsAndAncestors,
  capabilitiesOfSubtree,
  overreach,
  replacementOverreach,
} from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { etagOf, matches, requiredPrecondition } from '#/service/etag';
import { groupWireShape } from '#/service/group-wire';
import { AMENDABLE_GROUP_FIELDS, refusalFor } from '#/service/group-patch';
import {
  guardLastAdministrator,
  type LastAdministratorRefusal,
} from '#/usecase/last-administrator';
import {
  prefixRangeConditions,
  requireSearchKey,
  type ListPosition,
} from '#/usecase/prefix-search';
import { roleAssignmentColumns, type RoleAssignment } from '#/usecase/subjects';

const COLLECTION = 'groups';

export interface GroupAuditEvent {
  readonly action: 'group.create' | 'group.amend' | 'group.delete' | 'group.roles_set';
  readonly resourceType: 'group';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: GroupAuditEvent) => Promise<void>;

/** Every `listGroupsQuerySchema` parameter except the page controls. */
export type GroupFilters = Omit<ListGroupsQuery, 'cursor' | 'limit'>;

export interface ListGroupsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  readonly filters: GroupFilters;
}

export type ListGroupsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly Group[]; next: string | null };

/** The groups listing's order, which its keyset cursor and its count both follow. */
export function groupListOrder(filters: GroupFilters): SQL[] {
  return filters.name === undefined ? [asc(groups.id)] : [asc(groups.nameSearch), asc(groups.id)];
}

/** The WHERE clause of the groups listing, and of its count, which passes no position. */
export async function groupListConditions(
  tx: TenantScopedDatabase,
  filters: GroupFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (filters.parent === 'root') conditions.push(isNull(groups.parentId));
  else if (filters.parent !== undefined) conditions.push(eq(groups.parentId, filters.parent));
  if (filters.name === undefined) {
    if (after !== undefined) conditions.push(gt(groups.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(tx, groups.nameSearch, groups.id, filters.name, position)),
  );
  return conditions;
}

// A searched listing is one range scan of `groups_name_search`
// (0075_list_indexes_roles_groups_scopes.sql), the way `listSubjects` is.
export async function listGroups(
  tx: TenantScopedDatabase,
  input: ListGroupsInput,
): Promise<ListGroupsOutcome> {
  const filters = filterDigest(input.filters);
  const prefix = input.filters.name;
  let after: ListPosition | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    if (prefix !== undefined && decoded.sort === undefined) return { kind: 'invalid_cursor' };
    after = { id: decoded.after, sort: decoded.sort };
  }

  const conditions = await groupListConditions(tx, input.filters, after);
  const rows = await tx
    .select()
    .from(groups)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(...groupListOrder(input.filters))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          ...(prefix === undefined ? {} : { sort: requireSearchKey(last.nameSearch) }),
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;

  return { kind: 'ok', items: page.map((row) => groupWireShape(row)), next };
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
  /** The caller's own admin-client capability names — see `AmendGroupInput`'s for the same ceiling. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateGroupDeps {
  readonly audit: Audit;
}

export type CreateGroupOutcome =
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'ok'; group: Group };

// `OduduError('group_not_found')` from `groupRepository.create` (a
// `parent_id` naming no group) propagates out of this function instead of
// appearing in a returned outcome — caught by the route the same way
// `ClientIdConflictError` is caught outside `withTenant` in
// `createClientHandler` (#/view/routes/clients.ts).
export async function createGroup(
  tx: TenantScopedDatabase,
  deps: CreateGroupDeps,
  input: CreateGroupInput,
): Promise<CreateGroupOutcome> {
  // The ceiling `amendGroup`'s reparent enforces, at the other door that
  // chooses a parent: creating a group under one whose roles reach a
  // capability the caller does not hold would place every subject added to
  // it above the caller. `ancestorsOf` answers the empty set for an id no
  // group holds, so an unknown parent still falls through to `create`'s
  // own `group_not_found`.
  if (input.parentId !== null) {
    // `groups.id` is a `uuid` column: a non-uuid `parent_id` would fail in
    // `ancestorsOf` before `create`'s own `group_not_found` ever gets a
    // chance to run, so it is refused the same way here, before that query.
    if (!isUuid(input.parentId)) {
      throw new OduduError('group_not_found', `no group with id ${input.parentId}`);
    }
    const requestedCapabilities = await capabilitiesOfGroupsAndAncestors(tx, [input.parentId]);
    const denied = overreach(requestedCapabilities, input.callerCapabilities);
    if (denied.length > 0) {
      await deps.audit(tx, {
        action: 'group.create',
        resourceType: 'group',
        resourceId: input.parentId,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { denied },
      });
      return { kind: 'capability_ceiling', requested: denied };
    }
  }

  const created = await groupRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    parentId: input.parentId,
  });

  await deps.audit(tx, {
    action: 'group.create',
    resourceType: 'group',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'ok', group: groupWireShape(created) };
}

export interface AmendGroupInput {
  readonly groupId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  /**
   * The caller's own admin-client capability names — the same ceiling
   * `setRoles` (#/usecase/subjects.ts) enforces, applied here to
   * reparenting in both directions: moving a group must never hand its
   * subjects a capability the caller does not hold, through the new
   * parent's chain, nor take one away, through the old parent's.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendGroupDeps {
  readonly audit: Audit;
}

export type AmendGroupOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_parent' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'cycle' }
  | { kind: 'ok'; group: Group; etag: string }
  | LastAdministratorRefusal;

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
  return guardLastAdministrator(
    tx,
    {
      action: 'group.amend',
      resourceType: 'group',
      resourceId: input.groupId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => amendGroupUnguarded(inner, deps, input),
  );
}

async function amendGroupUnguarded(
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

  if (typeof parentId === 'string') {
    // Before the ceiling: `ancestorsOf` returns the empty set for an id no
    // group holds, so the ceiling passes and `reparent` throws
    // `group_not_found` with nothing catching it.
    if (!isUuid(parentId) || (await groupRepository(tx).byId(parentId)) === null) {
      return { kind: 'unknown_parent' };
    }
  }

  if (parentId !== undefined) {
    const gained =
      typeof parentId === 'string' ? await capabilitiesOfGroupsAndAncestors(tx, [parentId]) : [];
    const lost =
      locked.parentId === null || locked.parentId === parentId
        ? []
        : await capabilitiesOfGroupsAndAncestors(tx, [locked.parentId]);
    const granted = overreach(new Set(gained), input.callerCapabilities);
    const removed = overreach(new Set(lost), input.callerCapabilities);
    const denied = [...new Set([...granted, ...removed])];
    if (denied.length > 0) {
      await deps.audit(tx, {
        action: 'group.amend',
        resourceType: 'group',
        resourceId: input.groupId,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { denied },
      });
      return { kind: 'capability_ceiling', requested: granted, removed };
    }
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

  await deps.audit(tx, {
    action: 'group.amend',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const after = await readGroup(tx, input.groupId);
  if (after.kind !== 'ok') {
    throw new Error(`group ${input.groupId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', group: after.group, etag: etagOf(after.group) };
}

export interface DeleteGroupInput {
  readonly groupId: string;
  /** See `AmendGroupInput`'s: what the delete takes away is held to it. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteGroupDeps {
  readonly audit: Audit;
}

export type DeleteGroupOutcome =
  | { kind: 'not_found' }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'deleted' }
  | LastAdministratorRefusal;

export async function deleteGroup(
  tx: TenantScopedDatabase,
  deps: DeleteGroupDeps,
  input: DeleteGroupInput,
): Promise<DeleteGroupOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'group.delete',
      resourceType: 'group',
      resourceId: input.groupId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => deleteGroupUnguarded(inner, deps, input),
  );
}

async function deleteGroupUnguarded(
  tx: TenantScopedDatabase,
  deps: DeleteGroupDeps,
  input: DeleteGroupInput,
): Promise<DeleteGroupOutcome> {
  if ((await lockGroupForAmend(tx, input.groupId)) === null) return { kind: 'not_found' };
  const denied = overreach(
    await capabilitiesOfSubtree(tx, input.groupId),
    input.callerCapabilities,
  );
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'group.delete',
      resourceType: 'group',
      resourceId: input.groupId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: [], removed: denied };
  }

  const deleted = await groupRepository(tx).delete(input.groupId);
  if (!deleted) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'group.delete',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'deleted' };
}

export interface SetGroupRolesInput {
  readonly groupId: string;
  readonly roleIds: readonly string[];
  /** The caller's own admin-client capability names — see `AmendGroupInput`'s for the same ceiling. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetGroupRolesDeps {
  readonly audit: Audit;
}

export type SetGroupRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string }
  | LastAdministratorRefusal;

export type ReadGroupRolesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string };

// Ordered by id so the list, and the `ETag` over it, are the same on every
// read of an unchanged mapping.
async function mappedRoles(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<readonly RoleAssignment[]> {
  return tx
    .select(roleAssignmentColumns)
    .from(groupRoles)
    .innerJoin(roles, eq(groupRoles.roleId, roles.id))
    .leftJoin(clients, eq(clients.id, roles.clientId))
    .where(eq(groupRoles.groupId, groupId))
    .orderBy(asc(roles.id));
}

export async function readGroupRoles(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<ReadGroupRolesOutcome> {
  const group = await groupRepository(tx).byId(groupId);
  if (group === null) return { kind: 'not_found' };
  const mapped = await mappedRoles(tx, groupId);
  return { kind: 'ok', roles: mapped, etag: etagOf({ items: mapped }) };
}

// Locked for the same reason `setRoles` (#/usecase/subjects.ts) locks its
// subject: a mutex around the delete-then-insert `groupRepository.setRoles`
// performs, so two concurrent replacements serialise instead of each
// committing a partial view of the other's write.
async function lockGroupForRoles(
  tx: TenantScopedDatabase,
  groupId: string,
): Promise<typeof groups.$inferSelect | null> {
  const rows = await tx.select().from(groups).where(eq(groups.id, groupId)).for('update');
  return rows[0] ?? null;
}

/** Replaces the role set a group maps to wholesale — a role left out is one the caller clears. */
export async function setGroupRoles(
  tx: TenantScopedDatabase,
  deps: SetGroupRolesDeps,
  input: SetGroupRolesInput,
): Promise<SetGroupRolesOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'group.roles_set',
      resourceType: 'group',
      resourceId: input.groupId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => setGroupRolesUnguarded(inner, deps, input),
  );
}

async function setGroupRolesUnguarded(
  tx: TenantScopedDatabase,
  deps: SetGroupRolesDeps,
  input: SetGroupRolesInput,
): Promise<SetGroupRolesOutcome> {
  const group = await lockGroupForRoles(tx, input.groupId);
  if (group === null) return { kind: 'not_found' };

  // Under the same lock the replacement runs under, so the mapping this
  // hashes is the mapping being overwritten.
  const precondition = requiredPrecondition(
    input.ifMatch,
    etagOf({ items: await mappedRoles(tx, input.groupId) }),
  );
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const uniqueRoleIds = [...new Set(input.roleIds)];
  // `roles.id` is a `uuid` column: a non-uuid entry is left out of the
  // query rather than sent to it, and falls out as missing below the same
  // way a well-formed but nonexistent id does.
  const queryableRoleIds = uniqueRoleIds.filter(isUuid);
  const found =
    queryableRoleIds.length === 0
      ? []
      : await tx
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(inArray(roles.id, queryableRoleIds));
  const foundIds = new Set(found.map((role) => role.id));
  const missing = uniqueRoleIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { kind: 'unknown_role', roleIds: missing };
  }

  // The same ceiling `setRoles` (#/usecase/subjects.ts) enforces, on the
  // delta: a role mapped here must not hand the group's subjects a
  // capability the caller does not hold, nor a role left out take one away.
  const breach = await replacementOverreach(
    tx,
    (await mappedRoles(tx, input.groupId)).map((role) => role.id),
    uniqueRoleIds,
    input.callerCapabilities,
  );
  const denied = [...new Set([...breach.granted, ...breach.removed])];
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'group.roles_set',
      resourceType: 'group',
      resourceId: input.groupId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: breach.granted, removed: breach.removed };
  }

  await groupRepository(tx).setRoles(input.groupId, uniqueRoleIds);

  await deps.audit(tx, {
    action: 'group.roles_set',
    resourceType: 'group',
    resourceId: input.groupId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const mapped = await mappedRoles(tx, input.groupId);
  return { kind: 'ok', roles: mapped, etag: etagOf({ items: mapped }) };
}
