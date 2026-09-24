import { type Client, type ClientScope } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository, roles } from '@odudu/domain-authz';
import {
  clientScopeRepository,
  clientScopes,
  clients,
  type ClientScopeAssignment,
} from '@odudu/domain-tenant';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_SCOPE_FIELDS, refusalFor } from '#/service/scope-patch';
import { clientWireShape, readClient } from '#/usecase/clients';
import { type RoleAssignment } from '#/usecase/subjects';

const COLLECTION = 'scopes';

export interface ScopeAuditEvent {
  readonly action:
    'scope.create' | 'scope.amend' | 'scope.delete' | 'scope.roles_set' | 'scope.assign_to_client';
  readonly resourceType: 'scope';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: ScopeAuditEvent) => Promise<void>;

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

  await deps.audit({
    action: 'scope.create',
    resourceType: 'scope',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
  });

  return scopeWireShape(created);
}

export interface AmendScopeInput {
  readonly scopeId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
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

  const before = await readScope(tx, input.scopeId);
  if (before.kind !== 'ok') return { kind: 'not_found' };

  const currentEtag = etagOf(before.scope);
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  // Every field is validated before any of them is written — see
  // `amendSubject` (#/usecase/subjects.ts) for why a refusal must never
  // leave a partial write behind.
  const patch: {
    description?: string | null;
    includeInIdToken?: boolean;
    includeInAccessToken?: boolean;
  } = {};
  if ('description' in input.values) {
    const value = input.values.description;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'description',
        description: 'description must be a string or null',
      };
    }
    patch.description = value;
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
    patch.includeInIdToken = value;
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
    patch.includeInAccessToken = value;
  }

  if (Object.keys(patch).length > 0) {
    await clientScopeRepository(tx).amend(input.scopeId, patch);
  }

  await deps.audit({
    action: 'scope.amend',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
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

  await deps.audit({
    action: 'scope.delete',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
  });
  return { kind: 'deleted' };
}

export interface SetScopeRolesInput {
  readonly scopeId: string;
  readonly roleIds: readonly string[];
  readonly actorSubjectId: string;
}

export interface SetScopeRolesDeps {
  readonly audit: Audit;
}

export type SetScopeRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'ok'; roles: readonly RoleAssignment[] };

/** Replaces the role set a scope maps to wholesale — a role left out is one the caller clears. */
export async function setScopeRoles(
  tx: TenantScopedDatabase,
  deps: SetScopeRolesDeps,
  input: SetScopeRolesInput,
): Promise<SetScopeRolesOutcome> {
  const scope = await clientScopeRepository(tx).byId(input.scopeId);
  if (scope === null) return { kind: 'not_found' };

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

  await roleRepository(tx).setClientScopeRoles(input.scopeId, uniqueRoleIds);

  await deps.audit({
    action: 'scope.roles_set',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ok', roles: found };
}

export interface AssignScopeToClientInput {
  readonly scopeId: string;
  readonly clientId: string;
  readonly assignment: ClientScopeAssignment;
  readonly actorSubjectId: string;
}

export interface AssignScopeToClientDeps {
  readonly audit: Audit;
}

export type AssignScopeToClientOutcome =
  { kind: 'scope_not_found' } | { kind: 'client_not_found' } | { kind: 'ok'; client: Client };

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

  await deps.audit({
    action: 'scope.assign_to_client',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
  });

  const outcome = await readClient(tx, input.clientId);
  if (outcome.kind !== 'ok') {
    throw new Error(
      `client ${input.clientId} not found immediately after its own scope assignment`,
    );
  }
  return { kind: 'ok', client: clientWireShape(outcome.client) };
}
