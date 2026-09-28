import { type ListRolesQuery, type Role } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository, roles, rolesReachableFrom } from '@odudu/domain-authz';
import { clients } from '@odudu/domain-tenant';
import { isUuid, OduduError } from '@odudu/kernel';
import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { redactedDiff } from '#/service/audit-detail';
import { capabilitiesReachableFrom, overreach } from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_ROLE_FIELDS, refusalFor } from '#/service/role-patch';
import {
  guardLastAdministrator,
  type LastAdministratorRefusal,
} from '#/usecase/last-administrator';
import {
  prefixRangeConditions,
  requireSearchKey,
  type ListPosition,
} from '#/usecase/prefix-search';

const COLLECTION = 'roles';

export interface RoleAuditEvent {
  readonly action:
    | 'role.create'
    | 'role.amend'
    | 'role.delete'
    | 'role.composite_add'
    | 'role.composite_remove'
    | 'role.default_set';
  readonly resourceType: 'role';
  /** Null only for a refused create, which never produced a role. */
  readonly resourceId: string | null;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: RoleAuditEvent) => Promise<void>;

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  clientId: string | null;
  defaultForNewSubjects: boolean;
  createdAt: Date;
}

export function roleWireShape(role: RoleRow, clientKey: string | null): Role {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    client_id: role.clientId,
    client_key: clientKey,
    default_for_new_subjects: role.defaultForNewSubjects,
    created_at: role.createdAt.toISOString(),
  };
}

// Each owning client's own `client_id`, read once for however many roles.
export async function rolesWire(
  tx: TenantScopedDatabase,
  rows: readonly RoleRow[],
): Promise<Role[]> {
  const ids = [...new Set(rows.flatMap((row) => (row.clientId === null ? [] : [row.clientId])))];
  const keys =
    ids.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await tx
              .select({ id: clients.id, key: clients.clientId })
              .from(clients)
              .where(inArray(clients.id, ids))
          ).map((row) => [row.id, row.key]),
        );
  return rows.map((row) =>
    roleWireShape(row, row.clientId === null ? null : (keys.get(row.clientId) ?? null)),
  );
}

async function roleWire(tx: TenantScopedDatabase, row: RoleRow): Promise<Role> {
  const [wire] = await rolesWire(tx, [row]);
  if (wire === undefined) throw new Error(`role ${row.id} has no wire shape`);
  return wire;
}

/** Every `listRolesQuerySchema` parameter except the page controls. */
export type RoleFilters = Omit<ListRolesQuery, 'cursor' | 'limit'>;

export interface ListRolesInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  readonly filters: RoleFilters;
}

export type ListRolesOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly Role[]; next: string | null };

function roleOwnerConditions(filters: RoleFilters): SQL[] {
  if (filters.client === undefined) return [];
  return [
    filters.client === 'tenant' ? isNull(roles.clientId) : eq(roles.clientId, filters.client),
  ];
}

/** The roles listing's order, which its keyset cursor and its count both follow. */
export function roleListOrder(filters: RoleFilters): SQL[] {
  return filters.name === undefined ? [asc(roles.id)] : [asc(roles.nameSearch), asc(roles.id)];
}

/** The WHERE clause of the roles listing, and of its count, which passes no position. */
export async function roleListConditions(
  tx: TenantScopedDatabase,
  filters: RoleFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions: SQL[] = roleOwnerConditions(filters);
  if (filters.name === undefined) {
    if (after !== undefined) conditions.push(gt(roles.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(tx, roles.nameSearch, roles.id, filters.name, position)),
  );
  return conditions;
}

// A searched listing is one range scan of `roles_name_search`
// (0075_list_indexes_roles_groups_scopes.sql), the way `listSubjects` is.
export async function listRoles(
  tx: TenantScopedDatabase,
  input: ListRolesInput,
): Promise<ListRolesOutcome> {
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

  const conditions = await roleListConditions(tx, input.filters, after);
  const rows = await tx
    .select()
    .from(roles)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(...roleListOrder(input.filters))
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

  return { kind: 'ok', items: await rolesWire(tx, page), next };
}

export type ReadRoleOutcome = { kind: 'not_found' } | { kind: 'ok'; role: Role };

export async function readRole(tx: TenantScopedDatabase, roleId: string): Promise<ReadRoleOutcome> {
  const role = await roleRepository(tx).byId(roleId);
  return role === null ? { kind: 'not_found' } : { kind: 'ok', role: await roleWire(tx, role) };
}

export interface CreateRoleInput {
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly clientId: string | null;
  readonly defaultForNewSubjects: boolean;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateRoleDeps {
  readonly audit: Audit;
}

export type CreateRoleOutcome =
  | { kind: 'unknown_client' }
  | { kind: 'default_on_admin_client'; adminClient: string }
  | { kind: 'ok'; role: Role };

export async function createRole(
  tx: TenantScopedDatabase,
  deps: CreateRoleDeps,
  input: CreateRoleInput,
): Promise<CreateRoleOutcome> {
  // `roles_client_fk` would refuse this too, but as a foreign-key
  // violation rather than the unique violation the route knows how to turn
  // into a 409 — and a `client_id` that is not a uuid at all fails in the
  // driver before any constraint is consulted.
  if (input.clientId !== null) {
    if (!isUuid(input.clientId)) return { kind: 'unknown_client' };
    const owner = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, input.clientId));
    if (owner.length === 0) return { kind: 'unknown_client' };
    const adminClient = input.defaultForNewSubjects
      ? await builtinAdminClientOf(tx, input.clientId)
      : null;
    if (adminClient !== null) {
      await deps.audit(tx, {
        action: 'role.create',
        resourceType: 'role',
        resourceId: null,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { denied: [input.name], client_id: input.clientId },
      });
      return { kind: 'default_on_admin_client', adminClient };
    }
  }

  const created = await roleRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    clientId: input.clientId,
    defaultForNewSubjects: input.defaultForNewSubjects,
  });

  await deps.audit(tx, {
    action: 'role.create',
    resourceType: 'role',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'ok', role: await roleWire(tx, created) };
}

export interface AmendRoleInput {
  readonly roleId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendRoleDeps {
  readonly audit: Audit;
}

export type AmendRoleOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; role: Role; etag: string };

// Wrapped in `{ value }` rather than the bare type — see `SubjectPatch`
// (#/usecase/subjects.ts) for why: it tells "cleared to null" apart from
// "untouched" with no second `in` check needed at the write site.
interface RolePatchInput {
  description?: { value: string | null };
}

// Locks the role for the rest of the transaction, the same reasoning
// `lockSubjectForAmend` (#/usecase/subjects.ts) locks its subject for: the
// `If-Match` comparison and the write that follows it must be the only
// ones running against this role.
async function lockRoleForAmend(
  tx: TenantScopedDatabase,
  roleId: string,
): Promise<typeof roles.$inferSelect | null> {
  const rows = await tx.select().from(roles).where(eq(roles.id, roleId)).for('update');
  return rows[0] ?? null;
}

export async function amendRole(
  tx: TenantScopedDatabase,
  deps: AmendRoleDeps,
  input: AmendRoleInput,
): Promise<AmendRoleOutcome> {
  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_ROLE_FIELDS.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field) ?? `${field} is not a role field`,
      };
    }
  }

  const locked = await lockRoleForAmend(tx, input.roleId);
  if (locked === null) return { kind: 'not_found' };

  const currentEtag = etagOf(await roleWire(tx, locked));
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  // Every field is validated before any of them is written into `patch` —
  // see `amendSubject` (#/usecase/subjects.ts) for why a refusal must
  // never leave a partial write behind, and why phase two reads only
  // `patch`, never `input.values` again.
  const patch: RolePatchInput = {};
  if ('description' in input.values) {
    const value = input.values.description;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'description',
        description: 'description must be a string or null',
      };
    }
    patch.description = { value };
  }

  if (patch.description !== undefined) {
    await roleRepository(tx).amend(input.roleId, { description: patch.description.value });
  }

  await deps.audit(tx, {
    action: 'role.amend',
    resourceType: 'role',
    resourceId: input.roleId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const after = await readRole(tx, input.roleId);
  if (after.kind !== 'ok') {
    throw new Error(`role ${input.roleId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', role: after.role, etag: etagOf(after.role) };
}

export interface DeleteRoleInput {
  readonly roleId: string;
  /** The caller's own admin capabilities: what the delete takes from every holder is held to them. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteRoleDeps {
  readonly audit: Audit;
}

export type DeleteRoleOutcome =
  | { kind: 'not_found' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'deleted' }
  | LastAdministratorRefusal;

// The `client_id` of the tenant's built-in admin client when `clientDbId`
// names it, else null. Reads `builtinAdmin`, never the `client_id` string,
// so a rename in the database cannot slip past a guard built on it.
async function builtinAdminClientOf(
  tx: TenantScopedDatabase,
  clientDbId: string | null,
): Promise<string | null> {
  if (clientDbId === null) return null;
  const rows = await tx
    .select({ clientId: clients.clientId, builtinAdmin: clients.builtinAdmin })
    .from(clients)
    .where(eq(clients.id, clientDbId));
  const owner = rows[0];
  return owner?.builtinAdmin === true ? owner.clientId : null;
}

// `subject_roles_role_fk` cascades, so deleting a capability role strips it
// from every administrator holding it — `tenant-admin` deleted by a caller
// who only holds `manage-tenant` locks the tenant out of its own admin API,
// and `manage-tenant` can delete itself. `amendClient` (#/usecase/clients.ts)
// guards the client for the same reason; this is the same door on the roles
// that client owns.
async function guardsAdministrators(
  tx: TenantScopedDatabase,
  role: { clientId: string | null; name: string },
): Promise<string | null> {
  const owner = await builtinAdminClientOf(tx, role.clientId);
  if (owner === null) return null;
  return (
    `${role.name} is a capability of ${owner}, this tenant's built-in ` +
    'admin client, and deleting it would strip it from every administrator holding it'
  );
}

export async function deleteRole(
  tx: TenantScopedDatabase,
  deps: DeleteRoleDeps,
  input: DeleteRoleInput,
): Promise<DeleteRoleOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'role.delete',
      resourceType: 'role',
      resourceId: input.roleId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => deleteRoleUnguarded(inner, deps, input),
  );
}

async function deleteRoleUnguarded(
  tx: TenantScopedDatabase,
  deps: DeleteRoleDeps,
  input: DeleteRoleInput,
): Promise<DeleteRoleOutcome> {
  const role = await lockRoleForAmend(tx, input.roleId);
  if (role === null) return { kind: 'not_found' };
  const reason = await guardsAdministrators(tx, role);
  if (reason !== null) {
    await deps.audit(tx, {
      action: 'role.delete',
      resourceType: 'role',
      resourceId: input.roleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'builtin_admin_guarded', reason };
  }
  const denied = overreach(
    await capabilitiesReachableFrom(tx, [input.roleId]),
    input.callerCapabilities,
  );
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'role.delete',
      resourceType: 'role',
      resourceId: input.roleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: [], removed: denied };
  }

  const deleted = await roleRepository(tx).delete(input.roleId);
  if (!deleted) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'role.delete',
    resourceType: 'role',
    resourceId: input.roleId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'deleted' };
}

// A role's direct composites as `GET …/composites` answers them, and what the
// `ETag` on that read and on every composite write is taken over.
async function compositesOf(tx: TenantScopedDatabase, roleId: string): Promise<readonly Role[]> {
  return rolesWire(tx, await roleRepository(tx).directComposites(roleId));
}

function compositesEtag(items: readonly Role[]): string {
  return etagOf({ items });
}

export interface AddRoleCompositeInput {
  readonly parentRoleId: string;
  readonly childRoleId: string;
  readonly ifMatch: string | undefined;
  /**
   * The caller's own admin-client capability names, expanded through
   * `role_composites` — the same ceiling `setRoles` (#/usecase/subjects.ts)
   * enforces. Nesting a role subgraph into a composite must never hand the
   * parent a capability the caller does not itself hold.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AddRoleCompositeDeps {
  readonly audit: Audit;
}

export type AddRoleCompositeOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_child_role' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'default_role_capability'; capabilities: readonly string[] }
  | { kind: 'cycle' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; etag: string };

// Locks both endpoints of the edge about to be written, so two concurrent
// `addComposite` calls that together would close a cycle (A→B and, at the
// same time, B→A) cannot each pass `closureFrom`'s check before either
// commits. Deadlock-freedom comes from both calls issuing the identical
// `inArray(...).for('update')` — one unordered-set predicate, scanned in
// the same plan order — not from the `.sort()` below, which buys nothing
// today and is kept only against a future rewrite into separate per-id
// statements, where a consistent order would start to matter.
async function lockRolesForComposite(
  tx: TenantScopedDatabase,
  parentRoleId: string,
  childRoleId: string,
): Promise<void> {
  const ids = [...new Set([parentRoleId, childRoleId])].sort();
  await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, ids)).for('update');
}

// A default role is handed to every subject created afterwards — through
// self-registration too, where the tenant allows it — so nothing it reaches
// may be an admin capability, whoever the caller is. Every composite write
// and every `true` default takes this lock, after its row locks and before
// it reads the graph: an edge that reaches no capability yet can still
// connect a default to one another writer is adding deeper down, so the
// lock must serialise all of them, not only those whose child reaches one.
async function lockDefaultRoleReach(tx: TenantScopedDatabase): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('role_default_reach'), hashtext(current_setting('app.tenant_id')))`,
  );
}

async function reachedByDefaultRole(tx: TenantScopedDatabase, roleId: string): Promise<boolean> {
  const defaults = await roleRepository(tx).defaultsForTenant();
  const reached = await rolesReachableFrom(
    tx,
    defaults.map((role) => role.id),
  );
  return reached.some((role) => role.roleId === roleId);
}

// The capability ceiling (CWE-269), applied to a composite edge instead of
// a subject's role set: everything `child_role_id` reaches — itself
// included — must already be within the caller's own capabilities, or the
// caller could grant itself one it does not hold by nesting it under a
// role it may already assign.
export async function addRoleComposite(
  tx: TenantScopedDatabase,
  deps: AddRoleCompositeDeps,
  input: AddRoleCompositeInput,
): Promise<AddRoleCompositeOutcome> {
  // `roles.id` is a `uuid` column: a non-uuid `child_role_id` would fail in
  // `lockRolesForComposite`'s own lookup before `byId` ever answers
  // `unknown_child_role`, so it is refused the same way here, before that
  // lock is taken.
  if (!isUuid(input.childRoleId)) return { kind: 'unknown_child_role' };

  await lockRolesForComposite(tx, input.parentRoleId, input.childRoleId);
  await lockDefaultRoleReach(tx);

  const parent = await roleRepository(tx).byId(input.parentRoleId);
  if (parent === null) return { kind: 'not_found' };
  const child = await roleRepository(tx).byId(input.childRoleId);
  if (child === null) return { kind: 'unknown_child_role' };
  const before = compositesEtag(await compositesOf(tx, input.parentRoleId));
  if (matches(input.ifMatch, before) === 'mismatch') return { kind: 'precondition_failed' };

  // The other half of `removeRoleComposite`'s guard: a capability role's
  // shape is what provisioning gives it (`capabilityRoleGraph`), so nothing
  // is nested under one — an edge that could never be removed again would
  // reshape the capability for every holder, and travel with every export.
  const owner = await builtinAdminClientOf(tx, parent.clientId);
  if (owner !== null) {
    const reason =
      `${parent.name} is a capability of ${owner}, this tenant's built-in admin client, ` +
      'and nothing is nested under a capability role';
    await deps.audit(tx, {
      action: 'role.composite_add',
      resourceType: 'role',
      resourceId: input.parentRoleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'builtin_admin_guarded', reason };
  }

  const requestedCapabilities = await capabilitiesReachableFrom(tx, [input.childRoleId]);
  const denied = overreach(requestedCapabilities, input.callerCapabilities);
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'role.composite_add',
      resourceType: 'role',
      resourceId: input.parentRoleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: denied };
  }

  if (requestedCapabilities.size > 0) {
    if (await reachedByDefaultRole(tx, input.parentRoleId)) {
      const capabilities = [...requestedCapabilities].sort();
      await deps.audit(tx, {
        action: 'role.composite_add',
        resourceType: 'role',
        resourceId: input.parentRoleId,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { denied: capabilities },
      });
      return { kind: 'default_role_capability', capabilities };
    }
  }

  try {
    await roleRepository(tx).addComposite(input.parentRoleId, input.childRoleId);
  } catch (error) {
    if (error instanceof OduduError && error.code === 'role_composite_cycle') {
      return { kind: 'cycle' };
    }
    throw error;
  }

  await deps.audit(tx, {
    action: 'role.composite_add',
    resourceType: 'role',
    resourceId: input.parentRoleId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'ok', etag: compositesEtag(await compositesOf(tx, input.parentRoleId)) };
}

export type ListRoleCompositesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; items: readonly Role[]; etag: string };

export async function listRoleComposites(
  tx: TenantScopedDatabase,
  roleId: string,
): Promise<ListRoleCompositesOutcome> {
  if ((await roleRepository(tx).byId(roleId)) === null) return { kind: 'not_found' };
  const items = await compositesOf(tx, roleId);
  return { kind: 'ok', items, etag: compositesEtag(items) };
}

export interface RemoveRoleCompositeInput {
  readonly parentRoleId: string;
  readonly childRoleId: string;
  readonly ifMatch: string | undefined;
  /** See `DeleteRoleInput`'s: what the edge hands every holder of the parent is held to them. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RemoveRoleCompositeDeps {
  readonly audit: Audit;
}

export type RemoveRoleCompositeOutcome =
  | { kind: 'not_found' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'precondition_failed' }
  | { kind: 'removed'; etag: string }
  | LastAdministratorRefusal;

// The edge-level twin of `guardsAdministrators`: taking `manage-users` out of
// `tenant-admin`, or `view-users` out of `manage-users`, strips it from every
// administrator holding the parent just as surely as deleting it would.
export async function removeRoleComposite(
  tx: TenantScopedDatabase,
  deps: RemoveRoleCompositeDeps,
  input: RemoveRoleCompositeInput,
): Promise<RemoveRoleCompositeOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'role.composite_remove',
      resourceType: 'role',
      resourceId: input.parentRoleId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => removeRoleCompositeUnguarded(inner, deps, input),
  );
}

async function removeRoleCompositeUnguarded(
  tx: TenantScopedDatabase,
  deps: RemoveRoleCompositeDeps,
  input: RemoveRoleCompositeInput,
): Promise<RemoveRoleCompositeOutcome> {
  const parent = await roleRepository(tx).byId(input.parentRoleId);
  if (parent === null) return { kind: 'not_found' };
  const owner = await builtinAdminClientOf(tx, parent.clientId);
  if (owner !== null) {
    const reason =
      `${parent.name} is a capability of ${owner}, this tenant's built-in admin client, ` +
      'and removing a composite from it would strip that from every administrator holding it';
    await deps.audit(tx, {
      action: 'role.composite_remove',
      resourceType: 'role',
      resourceId: input.parentRoleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'builtin_admin_guarded', reason };
  }

  if (!isUuid(input.childRoleId)) return { kind: 'not_found' };
  await lockRolesForComposite(tx, input.parentRoleId, input.childRoleId);
  const children = await compositesOf(tx, input.parentRoleId);
  if (matches(input.ifMatch, compositesEtag(children)) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }
  if (!children.some((child) => child.id === input.childRoleId)) return { kind: 'not_found' };
  const denied = overreach(
    await capabilitiesReachableFrom(tx, [input.childRoleId]),
    input.callerCapabilities,
  );
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'role.composite_remove',
      resourceType: 'role',
      resourceId: input.parentRoleId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { child_role_id: input.childRoleId, denied },
    });
    return { kind: 'capability_ceiling', requested: [], removed: denied };
  }

  const removed = await roleRepository(tx).removeComposite(input.parentRoleId, input.childRoleId);
  if (!removed) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'role.composite_remove',
    resourceType: 'role',
    resourceId: input.parentRoleId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { child_role_id: input.childRoleId },
  });
  return { kind: 'removed', etag: compositesEtag(await compositesOf(tx, input.parentRoleId)) };
}

export interface SetRoleDefaultInput {
  readonly roleId: string;
  readonly value: boolean;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetRoleDefaultDeps {
  readonly audit: Audit;
}

export type SetRoleDefaultOutcome =
  | { kind: 'not_found' }
  | { kind: 'default_role_capability'; capabilities: readonly string[] }
  | { kind: 'ok'; role: Role; etag: string };

// Stricter than the capability ceiling `addRoleComposite` applies, and so
// subsuming it: the ceiling admits what the caller holds, this admits no
// capability at all. Unsetting is never refused.
export async function setRoleDefault(
  tx: TenantScopedDatabase,
  deps: SetRoleDefaultDeps,
  input: SetRoleDefaultInput,
): Promise<SetRoleDefaultOutcome> {
  const locked = await lockRoleForAmend(tx, input.roleId);
  if (locked === null) return { kind: 'not_found' };
  const before = await roleWire(tx, locked);

  if (input.value) {
    await lockDefaultRoleReach(tx);
    const capabilities = [...(await capabilitiesReachableFrom(tx, [input.roleId]))].sort();
    if (capabilities.length > 0) {
      await deps.audit(tx, {
        action: 'role.default_set',
        resourceType: 'role',
        resourceId: input.roleId,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { denied: capabilities },
      });
      return { kind: 'default_role_capability', capabilities };
    }
  }

  await roleRepository(tx).setDefaultForNewSubjects(input.roleId, input.value);
  const after: Role = { ...before, default_for_new_subjects: input.value };

  await deps.audit(tx, {
    action: 'role.default_set',
    resourceType: 'role',
    resourceId: input.roleId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('role', before, after),
  });
  return { kind: 'ok', role: after, etag: etagOf(after) };
}
