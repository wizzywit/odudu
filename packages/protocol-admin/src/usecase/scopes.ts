import { type AssignScopeToClientResponse, type ClientScope } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clientScopeRoles, roleRepository, roles } from '@odudu/domain-authz';
import {
  clientScopeAssignments,
  clientScopeRepository,
  clientScopes,
  clients,
  type ClientScopeAssignment,
} from '@odudu/domain-tenant';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { capabilitiesReachableFrom, overreach } from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches, requiredPrecondition } from '#/service/etag';
import { AMENDABLE_SCOPE_FIELDS, refusalFor } from '#/service/scope-patch';
import { type RoleAssignment } from '#/usecase/subjects';

const COLLECTION = 'scopes';

export interface ScopeAuditEvent {
  readonly action:
    'scope.create' | 'scope.amend' | 'scope.delete' | 'scope.roles_set' | 'scope.assign_to_client';
  readonly resourceType: 'scope';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ScopeAuditEvent) => Promise<void>;

export function scopeWireShape(scope: {
  id: string;
  name: string;
  description: string | null;
  includeInIdToken: boolean;
  includeInAccessToken: boolean;
  createdAt: Date;
}): ClientScope {
  return {
    id: scope.id,
    name: scope.name,
    description: scope.description,
    include_in_id_token: scope.includeInIdToken,
    include_in_access_token: scope.includeInAccessToken,
    created_at: scope.createdAt.toISOString(),
  };
}

export interface ListScopesInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
}

export type ListScopesOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly ClientScope[]; next: string | null };

export async function listScopes(
  tx: TenantScopedDatabase,
  input: ListScopesInput,
): Promise<ListScopesOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await tx
    .select()
    .from(clientScopes)
    .where(after === undefined ? undefined : gt(clientScopes.id, after))
    .orderBy(asc(clientScopes.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map((row) =>
    scopeWireShape({
      id: row.id,
      name: row.name,
      description: row.description,
      includeInIdToken: row.includeInIdToken,
      includeInAccessToken: row.includeInAccessToken,
      createdAt: row.createdAt,
    }),
  );
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

export type ReadScopeOutcome = { kind: 'not_found' } | { kind: 'ok'; scope: ClientScope };

export async function readScope(
  tx: TenantScopedDatabase,
  scopeId: string,
): Promise<ReadScopeOutcome> {
  const scope = await clientScopeRepository(tx).byId(scopeId);
  return scope === null ? { kind: 'not_found' } : { kind: 'ok', scope: scopeWireShape(scope) };
}

export interface CreateScopeInput {
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly includeInIdToken: boolean | undefined;
  readonly includeInAccessToken: boolean | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateScopeDeps {
  readonly audit: Audit;
}

// `client_scopes_name_unique` (0016_client_scopes.sql) is what actually
// refuses a duplicate. It is left to propagate out of this function rather
// than caught here: by the time the unique-index violation fires, the
// INSERT has already aborted this transaction at the database level, and
// nothing run afterward in the same transaction — including a normal
// return — can un-abort it. The route catches it outside `withTenant`, the
// same shape `ClientIdConflictError` is caught in
// (`createClientHandler`, #/view/routes/clients.ts).
export async function createScope(
  tx: TenantScopedDatabase,
  deps: CreateScopeDeps,
  input: CreateScopeInput,
): Promise<ClientScope> {
  const created = await clientScopeRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    ...(input.includeInIdToken !== undefined ? { includeInIdToken: input.includeInIdToken } : {}),
    ...(input.includeInAccessToken !== undefined
      ? { includeInAccessToken: input.includeInAccessToken }
      : {}),
  });

  await deps.audit(tx, {
    action: 'scope.create',
    resourceType: 'scope',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return scopeWireShape(created);
}

export interface AmendScopeInput {
  readonly scopeId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendScopeDeps {
  readonly audit: Audit;
}

export type AmendScopeOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; scope: ClientScope; etag: string };

// Wrapped in `{ value }` rather than the bare type — see `SubjectPatch`
// (#/usecase/subjects.ts) for why: it tells "cleared to null" apart from
// "untouched" with no second `in` check needed at the write site.
interface ScopePatchInput {
  description?: { value: string | null };
  includeInIdToken?: { value: boolean };
  includeInAccessToken?: { value: boolean };
}

// Locks the scope for the rest of the transaction, the same reasoning
// `lockRoleForAmend`/`lockGroupForAmend` (#/usecase/roles.ts,
// #/usecase/groups.ts) lock theirs for: the `If-Match` comparison and the
// write that follows it must be the only ones running against this scope.
async function lockScopeForAmend(
  tx: TenantScopedDatabase,
  scopeId: string,
): Promise<typeof clientScopes.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(clientScopes)
    .where(eq(clientScopes.id, scopeId))
    .for('update');
  return rows[0] ?? null;
}

export async function amendScope(
  tx: TenantScopedDatabase,
  deps: AmendScopeDeps,
  input: AmendScopeInput,
): Promise<AmendScopeOutcome> {
  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_SCOPE_FIELDS.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field) ?? `${field} is not a scope field`,
      };
    }
  }

  const locked = await lockScopeForAmend(tx, input.scopeId);
  if (locked === null) return { kind: 'not_found' };

  const currentEtag = etagOf(scopeWireShape(locked));
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  // Every field is validated before any of them is written into `patch` —
  // see `amendSubject` (#/usecase/subjects.ts) for why a refusal must
  // never leave a partial write behind, and why phase two reads only
  // `patch`, never `input.values` again.
  const patch: ScopePatchInput = {};
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
  if ('include_in_id_token' in input.values) {
    const value = input.values.include_in_id_token;
    if (typeof value !== 'boolean') {
      return {
        kind: 'invalid_value',
        field: 'include_in_id_token',
        description: 'include_in_id_token must be a boolean',
      };
    }
    patch.includeInIdToken = { value };
  }
  if ('include_in_access_token' in input.values) {
    const value = input.values.include_in_access_token;
    if (typeof value !== 'boolean') {
      return {
        kind: 'invalid_value',
        field: 'include_in_access_token',
        description: 'include_in_access_token must be a boolean',
      };
    }
    patch.includeInAccessToken = { value };
  }

  if (
    patch.description !== undefined ||
    patch.includeInIdToken !== undefined ||
    patch.includeInAccessToken !== undefined
  ) {
    await clientScopeRepository(tx).amend(input.scopeId, {
      ...(patch.description !== undefined ? { description: patch.description.value } : {}),
      ...(patch.includeInIdToken !== undefined
        ? { includeInIdToken: patch.includeInIdToken.value }
        : {}),
      ...(patch.includeInAccessToken !== undefined
        ? { includeInAccessToken: patch.includeInAccessToken.value }
        : {}),
    });
  }

  await deps.audit(tx, {
    action: 'scope.amend',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const after = await readScope(tx, input.scopeId);
  if (after.kind !== 'ok') {
    throw new Error(`scope ${input.scopeId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', scope: after.scope, etag: etagOf(after.scope) };
}

export interface DeleteScopeInput {
  readonly scopeId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteScopeDeps {
  readonly audit: Audit;
}

export type DeleteScopeOutcome = { kind: 'not_found' } | { kind: 'deleted' };

// `client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk`
// (0016_client_scopes.sql, 0017_roles.sql) both cascade: deleting a scope
// silently takes every client assignment and role mapping naming it with
// it, never refusing on either.
export async function deleteScope(
  tx: TenantScopedDatabase,
  deps: DeleteScopeDeps,
  input: DeleteScopeInput,
): Promise<DeleteScopeOutcome> {
  const deleted = await clientScopeRepository(tx).delete(input.scopeId);
  if (!deleted) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'scope.delete',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'deleted' };
}

export interface SetScopeRolesInput {
  readonly scopeId: string;
  readonly roleIds: readonly string[];
  /**
   * The caller's own admin-client capability names — the same ceiling
   * `setRoles` (#/usecase/subjects.ts) enforces. `reachableRoleIds`
   * (read fresh per token issuance, @odudu/protocol-oidc) is what turns a
   * scope's role mapping into claims on a token, so mapping a role here
   * must never surface a capability the caller does not itself hold into a
   * client that previously could not reach it.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetScopeRolesDeps {
  readonly audit: Audit;
}

export type SetScopeRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'capability_ceiling'; requested: readonly string[] }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string };

export type ReadScopeRolesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string };

// Ordered by id so the list, and the `ETag` over it, are the same on every
// read of an unchanged mapping.
async function mappedRoles(
  tx: TenantScopedDatabase,
  scopeId: string,
): Promise<readonly RoleAssignment[]> {
  return tx
    .select({ id: roles.id, name: roles.name })
    .from(clientScopeRoles)
    .innerJoin(roles, eq(clientScopeRoles.roleId, roles.id))
    .where(eq(clientScopeRoles.clientScopeId, scopeId))
    .orderBy(asc(roles.id));
}

export async function readScopeRoles(
  tx: TenantScopedDatabase,
  scopeId: string,
): Promise<ReadScopeRolesOutcome> {
  const scope = await clientScopeRepository(tx).byId(scopeId);
  if (scope === null) return { kind: 'not_found' };
  const mapped = await mappedRoles(tx, scopeId);
  return { kind: 'ok', roles: mapped, etag: etagOf({ items: mapped }) };
}

// Locked for the same reason `setRoles` (#/usecase/subjects.ts) locks its
// subject: a mutex around the delete-then-insert
// `roleRepository.setClientScopeRoles` performs, so two concurrent
// replacements serialise instead of each committing a partial view of the
// other's write.
async function lockScopeForRoles(
  tx: TenantScopedDatabase,
  scopeId: string,
): Promise<typeof clientScopes.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(clientScopes)
    .where(eq(clientScopes.id, scopeId))
    .for('update');
  return rows[0] ?? null;
}

/** Replaces the role set a scope maps to wholesale — a role left out is one the caller clears. */
export async function setScopeRoles(
  tx: TenantScopedDatabase,
  deps: SetScopeRolesDeps,
  input: SetScopeRolesInput,
): Promise<SetScopeRolesOutcome> {
  const scope = await lockScopeForRoles(tx, input.scopeId);
  if (scope === null) return { kind: 'not_found' };

  // Under the same lock the replacement runs under, so the mapping this
  // hashes is the mapping being overwritten.
  const precondition = requiredPrecondition(
    input.ifMatch,
    etagOf({ items: await mappedRoles(tx, input.scopeId) }),
  );
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

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

  const requestedCapabilities = await capabilitiesReachableFrom(tx, uniqueRoleIds);
  const denied = overreach(requestedCapabilities, input.callerCapabilities);
  if (denied.length > 0) {
    return { kind: 'capability_ceiling', requested: denied };
  }

  await roleRepository(tx).setClientScopeRoles(input.scopeId, uniqueRoleIds);

  await deps.audit(tx, {
    action: 'scope.roles_set',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const mapped = await mappedRoles(tx, input.scopeId);
  return { kind: 'ok', roles: mapped, etag: etagOf({ items: mapped }) };
}

export interface AssignScopeToClientInput {
  readonly scopeId: string;
  readonly clientId: string;
  readonly assignment: ClientScopeAssignment;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AssignScopeToClientDeps {
  readonly audit: Audit;
}

export type AssignScopeToClientOutcome =
  | { kind: 'scope_not_found' }
  | { kind: 'client_not_found' }
  | { kind: 'ok'; assignments: AssignScopeToClientResponse };

/**
 * Assigns or re-assigns a scope's `default`/`optional` split on a client —
 * `assignOrUpdate` (@odudu/domain-tenant) so a repeated call narrows or
 * widens the existing row instead of colliding on its primary key, the
 * same behaviour the seed CLI's own assign-scope command depends on.
 */
export async function assignScopeToClient(
  tx: TenantScopedDatabase,
  deps: AssignScopeToClientDeps,
  input: AssignScopeToClientInput,
): Promise<AssignScopeToClientOutcome> {
  const scope = await clientScopeRepository(tx).byId(input.scopeId);
  if (scope === null) return { kind: 'scope_not_found' };

  const clientRows = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId));
  if (clientRows.length === 0) return { kind: 'client_not_found' };

  await clientScopeRepository(tx).assignOrUpdate(input.clientId, input.scopeId, input.assignment);

  await deps.audit(tx, {
    action: 'scope.assign_to_client',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  // The client's scope assignments, never the client: this route asks only
  // for `manage-tenant`, where reading a client asks for `manage-clients`,
  // so answering with the whole representation would hand the weaker
  // holder `redirect_uris`, `jwks`, `audiences` and every grant setting.
  const rows = await tx
    .select({
      id: clientScopes.id,
      name: clientScopes.name,
      assignment: clientScopeAssignments.assignment,
    })
    .from(clientScopeAssignments)
    .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
    .where(eq(clientScopeAssignments.clientId, input.clientId));

  return {
    kind: 'ok',
    assignments: {
      client_id: input.clientId,
      scopes: rows.map((row) => ({
        id: row.id,
        name: row.name,
        assignment: row.assignment,
      })),
    },
  };
}
