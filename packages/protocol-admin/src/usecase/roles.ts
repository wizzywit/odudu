import { type Role } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository, roles } from '@odudu/domain-authz';
import { OduduError } from '@odudu/kernel';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { capabilitiesReachableFrom, overreach } from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_ROLE_FIELDS, refusalFor } from '#/service/role-patch';

const COLLECTION = 'roles';

export interface RoleAuditEvent {
  readonly action: 'role.create' | 'role.amend' | 'role.delete' | 'role.composite_add';
  readonly resourceType: 'role';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: RoleAuditEvent) => Promise<void>;

export function roleWireShape(role: {
  id: string;
  name: string;
  description: string | null;
  clientId: string | null;
  defaultForNewSubjects: boolean;
  createdAt: Date;
}): Role {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    client_id: role.clientId,
    default_for_new_subjects: role.defaultForNewSubjects,
    created_at: role.createdAt.toISOString(),
  };
}

export interface ListRolesInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
}

export type ListRolesOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly Role[]; next: string | null };

export async function listRoles(
  tx: TenantScopedDatabase,
  input: ListRolesInput,
): Promise<ListRolesOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await tx
    .select()
    .from(roles)
    .where(after === undefined ? undefined : gt(roles.id, after))
    .orderBy(asc(roles.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map(roleWireShape);
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

export type ReadRoleOutcome = { kind: 'not_found' } | { kind: 'ok'; role: Role };

export async function readRole(tx: TenantScopedDatabase, roleId: string): Promise<ReadRoleOutcome> {
  const role = await roleRepository(tx).byId(roleId);
  return role === null ? { kind: 'not_found' } : { kind: 'ok', role: roleWireShape(role) };
}

export interface CreateRoleInput {
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly clientId: string | null;
  readonly defaultForNewSubjects: boolean;
  readonly actorSubjectId: string;
}

export interface CreateRoleDeps {
  readonly audit: Audit;
}

export async function createRole(
  tx: TenantScopedDatabase,
  deps: CreateRoleDeps,
  input: CreateRoleInput,
): Promise<Role> {
  const created = await roleRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    clientId: input.clientId,
    defaultForNewSubjects: input.defaultForNewSubjects,
  });

  await deps.audit({
    action: 'role.create',
    resourceType: 'role',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
  });

  return roleWireShape(created);
}

export interface AmendRoleInput {
  readonly roleId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
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

  const currentEtag = etagOf(roleWireShape(locked));
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

  await deps.audit({
    action: 'role.amend',
    resourceType: 'role',
    resourceId: input.roleId,
    actorSubjectId: input.actorSubjectId,
  });

  const after = await readRole(tx, input.roleId);
  if (after.kind !== 'ok') {
    throw new Error(`role ${input.roleId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', role: after.role, etag: etagOf(after.role) };
}

export interface DeleteRoleInput {
  readonly roleId: string;
  readonly actorSubjectId: string;
}

export interface DeleteRoleDeps {
  readonly audit: Audit;
}

export type DeleteRoleOutcome = { kind: 'not_found' } | { kind: 'deleted' };

export async function deleteRole(
  tx: TenantScopedDatabase,
  deps: DeleteRoleDeps,
  input: DeleteRoleInput,
): Promise<DeleteRoleOutcome> {
  const deleted = await roleRepository(tx).delete(input.roleId);
  if (!deleted) return { kind: 'not_found' };

  await deps.audit({
    action: 'role.delete',
    resourceType: 'role',
    resourceId: input.roleId,
    actorSubjectId: input.actorSubjectId,
  });
  return { kind: 'deleted' };
}

export interface AddRoleCompositeInput {
  readonly parentRoleId: string;
  readonly childRoleId: string;
  /**
   * The caller's own admin-client capability names, expanded through
   * `role_composites` — the same ceiling `setRoles` (#/usecase/subjects.ts)
   * enforces. Nesting a role subgraph into a composite must never hand the
   * parent a capability the caller does not itself hold.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
}

export interface AddRoleCompositeDeps {
  readonly audit: Audit;
}

export type AddRoleCompositeOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_child_role' }
  | { kind: 'capability_ceiling'; requested: readonly string[] }
  | { kind: 'cycle' }
  | { kind: 'ok' };

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
  await lockRolesForComposite(tx, input.parentRoleId, input.childRoleId);

  const parent = await roleRepository(tx).byId(input.parentRoleId);
  if (parent === null) return { kind: 'not_found' };
  const child = await roleRepository(tx).byId(input.childRoleId);
  if (child === null) return { kind: 'unknown_child_role' };

  const requestedCapabilities = await capabilitiesReachableFrom(tx, [input.childRoleId]);
  const denied = overreach(requestedCapabilities, input.callerCapabilities);
  if (denied.length > 0) {
    return { kind: 'capability_ceiling', requested: denied };
  }

  try {
    await roleRepository(tx).addComposite(input.parentRoleId, input.childRoleId);
  } catch (error) {
    if (error instanceof OduduError && error.code === 'role_composite_cycle') {
      return { kind: 'cycle' };
    }
    throw error;
  }

  await deps.audit({
    action: 'role.composite_add',
    resourceType: 'role',
    resourceId: input.parentRoleId,
    actorSubjectId: input.actorSubjectId,
  });
  return { kind: 'ok' };
}
