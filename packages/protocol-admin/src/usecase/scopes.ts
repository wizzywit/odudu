import { BIDI_REFUSED_MESSAGE, refusesBidi } from '@odudu/contracts';
import {
  type AssignScopeToClientResponse,
  type ClientScope,
  type ListScopesQuery,
  type ListBuiltinScopesResponse,
  type ScopeClient,
  type ScopeImpact,
  DESCRIPTION_MAX,
  SCOPE_LIMIT,
  scopeLimitMessage,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clientScopeRoles, roleRepository, roles } from '@odudu/domain-authz';
import {
  ClientScopeLimitError,
  DefaultScopeLimitError,
  clientRepository,
  clientScopeAssignments,
  clientScopeRepository,
  clientScopes,
  clients,
  missingBuiltinScopeNames,
  restoreBuiltinScopes,
  TENANT_DEFAULT_SCOPE_NAMES,
  isBuiltinScopeName,
  type ClientScopeAssignment,
} from '@odudu/domain-tenant';
import { isUuid } from '@odudu/kernel';
import { and, asc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import { COUNT_CAP, countAtMost } from '#/usecase/capped-count';
import {
  capabilitiesReachableFrom,
  overreach,
  replacementOverreach,
} from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { readKeyedPage } from '#/service/in-order';
import { etagOf, matches, requiredPrecondition } from '#/service/etag';
import { builtinScopeConfirmationDetail } from '#/service/scope-delete';
import { AMENDABLE_SCOPE_FIELDS, refusalFor } from '#/service/scope-patch';
import { tenantLanguages } from '#/usecase/tenant-languages';
import { checkConsentText, checkDisplayOrder, checkScopeLocalised } from '#/service/scope-consent';
import {
  prefixRangeConditions,
  requireSearchKey,
  type ListPosition,
} from '#/usecase/prefix-search';
import {
  clientWireShape,
  readClient,
  refuseOverServiceAccountCeiling,
  type ClientCeilingCaller,
} from '#/usecase/clients';
import {
  roleAssignmentColumns,
  type RoleAssignment,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

const COLLECTION = 'scopes';

export interface ScopeAuditEvent {
  readonly action:
    | 'scope.create'
    | 'scope.amend'
    | 'scope.delete'
    | 'scope.restore_builtins'
    | 'scope.roles_set'
    | 'scope.assign_to_client'
    | 'scope.unassign_from_client';
  readonly resourceType: 'scope';
  readonly resourceId: string | null;
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
  defaultClientAssignment: ClientScopeAssignment | null;
  consentText: string | null;
  descriptionI18n: Record<string, string>;
  consentTextI18n: Record<string, string>;
  displayOrder: number;
  createdAt: Date;
}): ClientScope {
  return {
    id: scope.id,
    name: scope.name,
    description: scope.description,
    include_in_id_token: scope.includeInIdToken,
    include_in_access_token: scope.includeInAccessToken,
    default_client_assignment: scope.defaultClientAssignment,
    consent_text: scope.consentText,
    description_i18n: scope.descriptionI18n,
    consent_text_i18n: scope.consentTextI18n,
    display_order: scope.displayOrder,
    created_at: scope.createdAt.toISOString(),
  };
}

/** Every `listScopesQuerySchema` parameter except the page controls. */
export type ScopeFilters = Omit<ListScopesQuery, 'cursor' | 'limit'>;

export interface ListScopesInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  readonly filters: ScopeFilters;
}

export type ListScopesOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly ClientScope[]; next: string | null };

/** The client scopes listing's order, which its keyset cursor and its count both follow. */
export function scopeListOrder(filters: ScopeFilters): SQL[] {
  return filters.name === undefined
    ? [asc(clientScopes.id)]
    : [asc(clientScopes.nameSearch), asc(clientScopes.id)];
}

/** The WHERE clause of the client scopes listing, and of its count, which passes no position. */
export async function scopeListConditions(
  tx: TenantScopedDatabase,
  filters: ScopeFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (filters.name === undefined) {
    if (after !== undefined) conditions.push(gt(clientScopes.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(
      tx,
      clientScopes.nameSearch,
      clientScopes.id,
      filters.name,
      position,
    )),
  );
  return conditions;
}

// A searched listing is one range scan of `client_scopes_name_search`
// (0075_list_indexes_roles_groups_scopes.sql), the way `listSubjects` is.
export async function listScopes(
  tx: TenantScopedDatabase,
  input: ListScopesInput,
): Promise<ListScopesOutcome> {
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

  const conditions = await scopeListConditions(tx, input.filters, after);
  const where = conditions.length === 0 ? undefined : and(...conditions);
  const order = scopeListOrder(input.filters);
  // A search reads its page of keys from the search index alone, then the rows
  // by id: the planner prices a bitmap of every match against an ordered scan,
  // and the keys cost nothing it can get wrong.
  let rows: (typeof clientScopes.$inferSelect)[];
  if (prefix === undefined) {
    rows = await tx
      .select()
      .from(clientScopes)
      .where(where)
      .orderBy(...order)
      .limit(input.limit + 1);
  } else {
    rows = await readKeyedPage(
      async () =>
        (
          await tx
            .select({ id: clientScopes.id })
            .from(clientScopes)
            .where(where)
            .orderBy(...order)
            .limit(input.limit + 1)
        ).map((row) => row.id),
      (ids) =>
        tx
          .select()
          .from(clientScopes)
          .where(inArray(clientScopes.id, [...ids])),
      (row) => row.id,
    );
  }

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

  return {
    kind: 'ok',
    items: page.map((row) =>
      scopeWireShape({
        id: row.id,
        name: row.name,
        description: row.description,
        includeInIdToken: row.includeInIdToken,
        includeInAccessToken: row.includeInAccessToken,
        defaultClientAssignment: row.defaultClientAssignment,
        consentText: row.consentText,
        descriptionI18n: row.descriptionI18n,
        consentTextI18n: row.consentTextI18n,
        displayOrder: row.displayOrder,
        createdAt: row.createdAt,
      }),
    ),
    next,
  };
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
  readonly defaultClientAssignment: ClientScopeAssignment | null;
  readonly consentText: string | null;
  readonly descriptionI18n?: Record<string, string>;
  readonly consentTextI18n?: Record<string, string>;
  readonly displayOrder: number;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateScopeDeps {
  readonly audit: Audit;
}

/** Thrown by `createScope` when the tenant already defines `SCOPE_LIMIT` scopes. */
export class ScopeLimitError extends Error {
  constructor() {
    super(scopeLimitMessage());
    this.name = 'ScopeLimitError';
  }
}

/** Thrown by `createScope` when a per-language map is refused; the write has not happened. */
export class ScopeLocalisedTextError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ScopeLocalisedTextError';
    this.field = field;
  }
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
  const localised: Record<string, Record<string, string>> = {};
  const supplied = [
    ['description_i18n', input.descriptionI18n ?? {}],
    ['consent_text_i18n', input.consentTextI18n ?? {}],
  ] as const;
  const needed = supplied.filter(([, value]) => Object.keys(value).length > 0);
  const supported = needed.length === 0 ? undefined : await tenantLanguages(tx, input.tenantId);
  for (const [field, value] of supplied) {
    const checked = checkScopeLocalised(field, value, {
      ...(supported === undefined ? {} : { supported }),
    });
    if (checked.kind === 'invalid') {
      throw new ScopeLocalisedTextError(field, checked.message);
    }
    localised[field] = checked.value;
  }
  await clientScopeRepository(tx).lockCreation(input.tenantId);
  if ((await clientScopeRepository(tx).countUpTo(SCOPE_LIMIT)) >= SCOPE_LIMIT) {
    throw new ScopeLimitError();
  }
  const created = await clientScopeRepository(tx).create({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    ...(input.includeInIdToken !== undefined ? { includeInIdToken: input.includeInIdToken } : {}),
    ...(input.includeInAccessToken !== undefined
      ? { includeInAccessToken: input.includeInAccessToken }
      : {}),
    defaultClientAssignment: input.defaultClientAssignment,
    consentText: input.consentText,
    descriptionI18n: localised.description_i18n ?? {},
    consentTextI18n: localised.consent_text_i18n ?? {},
    displayOrder: input.displayOrder,
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
  | { kind: 'default_scope_limit'; message: string }
  | { kind: 'ok'; scope: ClientScope; etag: string };

// Wrapped in `{ value }` rather than the bare type — see `SubjectPatch`
// (#/usecase/subjects.ts) for why: it tells "cleared to null" apart from
// "untouched" with no second `in` check needed at the write site.
interface ScopePatchInput {
  description?: { value: string | null };
  includeInIdToken?: { value: boolean };
  includeInAccessToken?: { value: boolean };
  defaultClientAssignment?: { value: ClientScopeAssignment | null };
  consentText?: { value: string | null };
  descriptionI18n?: { value: Record<string, string> };
  consentTextI18n?: { value: Record<string, string> };
  displayOrder?: { value: number };
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
  let supportedLanguages: readonly string[] | undefined;
  if ('description' in input.values) {
    const value = input.values.description;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'description',
        description: 'description must be a string or null',
      };
    }
    if (
      typeof value === 'string' &&
      value.length > DESCRIPTION_MAX &&
      value !== locked.description
    ) {
      return {
        kind: 'invalid_value',
        field: 'description',
        description: `description must be at most ${String(DESCRIPTION_MAX)} characters`,
      };
    }
    if (refusesBidi(value, locked.description)) {
      return { kind: 'invalid_value', field: 'description', description: BIDI_REFUSED_MESSAGE };
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

  if ('default_client_assignment' in input.values) {
    const value = input.values.default_client_assignment;
    if (value !== null && value !== 'default' && value !== 'optional') {
      return {
        kind: 'invalid_value',
        field: 'default_client_assignment',
        description: 'default_client_assignment must be default, optional or null',
      };
    }
    patch.defaultClientAssignment = { value };
  }

  if ('consent_text' in input.values) {
    const checked = checkConsentText(input.values.consent_text, locked.consentText);
    if (checked.kind === 'invalid') {
      return { kind: 'invalid_value', field: 'consent_text', description: checked.message };
    }
    patch.consentText = { value: checked.value };
  }
  for (const [field, key, current] of [
    ['description_i18n', 'descriptionI18n', locked.descriptionI18n],
    ['consent_text_i18n', 'consentTextI18n', locked.consentTextI18n],
  ] as const) {
    if (!(field in input.values)) continue;
    supportedLanguages ??= await tenantLanguages(tx, locked.tenantId);
    const checked = checkScopeLocalised(field, input.values[field], {
      supported: supportedLanguages,
      current,
    });
    if (checked.kind === 'invalid') {
      return { kind: 'invalid_value', field, description: checked.message };
    }
    patch[key] = { value: checked.value };
  }
  if ('display_order' in input.values) {
    const checked = checkDisplayOrder(input.values.display_order);
    if (checked.kind === 'invalid') {
      return { kind: 'invalid_value', field: 'display_order', description: checked.message };
    }
    patch.displayOrder = { value: checked.value };
  }

  const columns = {
    ...(patch.description !== undefined ? { description: patch.description.value } : {}),
    ...(patch.includeInIdToken !== undefined
      ? { includeInIdToken: patch.includeInIdToken.value }
      : {}),
    ...(patch.includeInAccessToken !== undefined
      ? { includeInAccessToken: patch.includeInAccessToken.value }
      : {}),
    ...(patch.defaultClientAssignment !== undefined
      ? { defaultClientAssignment: patch.defaultClientAssignment.value }
      : {}),
    ...(patch.consentText !== undefined ? { consentText: patch.consentText.value } : {}),
    ...(patch.descriptionI18n !== undefined
      ? { descriptionI18n: patch.descriptionI18n.value }
      : {}),
    ...(patch.consentTextI18n !== undefined
      ? { consentTextI18n: patch.consentTextI18n.value }
      : {}),
    ...(patch.displayOrder !== undefined ? { displayOrder: patch.displayOrder.value } : {}),
  };
  if (Object.keys(columns).length > 0) {
    try {
      await clientScopeRepository(tx).amend(input.scopeId, columns);
    } catch (error) {
      if (error instanceof DefaultScopeLimitError) {
        return { kind: 'default_scope_limit', message: error.message };
      }
      throw error;
    }
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
  /** The caller's own admin capabilities: what the scope's role mappings reach is held to them. */
  readonly callerCapabilities: ReadonlySet<string>;
  /** The scope's own name, typed again: what deleting a built-in scope requires. */
  readonly confirm?: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteScopeDeps {
  readonly audit: Audit;
}

export type DeleteScopeOutcome =
  | { kind: 'not_found' }
  | { kind: 'openid_guarded'; reason: string }
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'builtin_confirmation_required'; reason: string }
  | { kind: 'deleted' };

type ScopeImpactOutcome = { kind: 'not_found' } | { kind: 'ok'; impact: ScopeImpact };

// Each count reads one index range, `client_scope_assignments_by_scope` and
// the primary key of `client_scope_roles`, and stops one row past the cap.
async function impactOf(
  tx: TenantScopedDatabase,
  scope: { id: string; name: string },
  cap: number,
): Promise<ScopeImpact> {
  const capped = async (table: typeof clientScopeAssignments | typeof clientScopeRoles) => {
    const n = await countAtMost(tx, { table, where: eq(table.clientScopeId, scope.id) }, cap + 1);
    return { count: Math.min(n, cap), capped: n > cap };
  };
  return {
    builtin: isBuiltinScopeName(scope.name),
    client_assignments: await capped(clientScopeAssignments),
    role_mappings: await capped(clientScopeRoles),
  };
}

/** What deleting the scope would take with it: two bounded counts and the scope row. */
export async function scopeImpact(
  tx: TenantScopedDatabase,
  scopeId: string,
  options: { readonly cap?: number } = {},
): Promise<ScopeImpactOutcome> {
  const scope = await clientScopeRepository(tx).byId(scopeId);
  if (scope === null) return { kind: 'not_found' };
  return { kind: 'ok', impact: await impactOf(tx, scope, options.cap ?? COUNT_CAP) };
}

function cascadeDetail(impact: ScopeImpact): Record<string, unknown> {
  const anyCapped = impact.client_assignments.capped || impact.role_mappings.capped;
  return {
    builtin: impact.builtin,
    client_assignments: impact.client_assignments.count,
    role_mappings: impact.role_mappings.count,
    ...(anyCapped ? { counts_capped: true } : {}),
  };
}

// `client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk`
// (0016_client_scopes.sql, 0017_roles.sql) both cascade: deleting a scope
// silently takes every client assignment and role mapping naming it with
// it, never refusing on either — except `openid` itself, guarded below.
export async function deleteScope(
  tx: TenantScopedDatabase,
  deps: DeleteScopeDeps,
  input: DeleteScopeInput,
): Promise<DeleteScopeOutcome> {
  const scope = await clientScopeRepository(tx).byId(input.scopeId);
  if (scope === null) return { kind: 'not_found' };

  // The cascade above takes `openid` off every client in the tenant in one
  // stroke, the built-in admin client included — and that client supports
  // no grant but `authorization_code`/`refresh_token` (`provisionAdminClient`,
  // packages/protocol-oidc/src/usecase/provision-admin-client.ts), whose
  // default requested scope is `openid` (`scopesAreGrantable`,
  // authorize-validation.ts). Losing it there locks every administrator of
  // this tenant out of a fresh login once their refresh token expires.
  if (scope.name === 'openid') {
    const reason =
      'openid is deleted along with every client’s assignment of it, ' +
      'this tenant’s built-in admin client’s included, and could lock ' +
      'out every administrator of this tenant';
    await deps.audit(tx, {
      action: 'scope.delete',
      resourceType: 'scope',
      resourceId: input.scopeId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'openid_guarded', reason };
  }

  // Judged the way `setScopeRoles` judges a role it leaves out, since the
  // cascade takes every one of the scope's role mappings.
  const denied = overreach(
    await capabilitiesReachableFrom(
      tx,
      (await mappedRoles(tx, input.scopeId)).map((role) => role.id),
    ),
    input.callerCapabilities,
  );
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'scope.delete',
      resourceType: 'scope',
      resourceId: input.scopeId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: [], removed: denied };
  }

  const impact = await impactOf(tx, scope, COUNT_CAP);
  if (impact.builtin && input.confirm !== scope.name) {
    const reason = builtinScopeConfirmationDetail(scope.name, impact);
    await deps.audit(tx, {
      action: 'scope.delete',
      resourceType: 'scope',
      resourceId: input.scopeId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason, ...cascadeDetail(impact) },
    });
    return { kind: 'builtin_confirmation_required', reason };
  }

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
    detail: cascadeDetail(impact),
  });
  return { kind: 'deleted' };
}

export async function listBuiltinScopes(
  tx: TenantScopedDatabase,
): Promise<ListBuiltinScopesResponse> {
  const missing = new Set(await missingBuiltinScopeNames(tx));
  return {
    items: TENANT_DEFAULT_SCOPE_NAMES.map((name) => ({ name, present: !missing.has(name) })),
  };
}

export interface RestoreBuiltinScopesInput {
  readonly tenantId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RestoreBuiltinScopesDeps {
  readonly audit: Audit;
}

export type RestoreBuiltinScopesOutcome =
  | { kind: 'restored'; created: readonly string[] }
  | { kind: 'scope_limit' }
  | { kind: 'default_scope_limit'; message: string };

// What is already there is never read for its settings, let alone changed:
// a restore creates what is missing and does nothing when nothing is.
export async function restoreBuiltins(
  tx: TenantScopedDatabase,
  deps: RestoreBuiltinScopesDeps,
  input: RestoreBuiltinScopesInput,
): Promise<RestoreBuiltinScopesOutcome> {
  const outcome = await restoreBuiltinScopes(tx, input.tenantId);
  const actor = {
    action: 'scope.restore_builtins',
    resourceType: 'scope',
    resourceId: null,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
  } as const;
  if (outcome.kind === 'restored') {
    if (outcome.created.length > 0) {
      await deps.audit(tx, { ...actor, outcome: 'allowed', detail: { created: outcome.created } });
    }
    return outcome;
  }
  const reason = outcome.kind === 'scope_limit' ? scopeLimitMessage() : outcome.message;
  await deps.audit(tx, { ...actor, outcome: 'refused', detail: { reason } });
  return outcome;
}

export interface SetScopeRolesInput {
  readonly scopeId: string;
  readonly roleIds: readonly string[];
  /**
   * The caller's own admin-client capability names — the same ceiling
   * `setRoles` (#/usecase/subjects.ts) enforces, on the delta.
   * `reachableRoleIds` (read fresh per token issuance, @odudu/protocol-oidc)
   * turns a scope's role mapping into claims on a token, so a role mapped
   * here must never surface a capability the caller does not hold, nor a
   * role left out withdraw one.
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
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
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
    .select(roleAssignmentColumns)
    .from(clientScopeRoles)
    .innerJoin(roles, eq(clientScopeRoles.roleId, roles.id))
    .leftJoin(clients, eq(clients.id, roles.clientId))
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

  const breach = await replacementOverreach(
    tx,
    (await mappedRoles(tx, input.scopeId)).map((role) => role.id),
    uniqueRoleIds,
    input.callerCapabilities,
  );
  const denied = [...new Set([...breach.granted, ...breach.removed])];
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'scope.roles_set',
      resourceType: 'scope',
      resourceId: input.scopeId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: breach.granted, removed: breach.removed };
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

export interface AssignScopeToClientInput extends ClientCeilingCaller {
  readonly scopeId: string;
  readonly clientId: string;
  readonly assignment: ClientScopeAssignment;
}

export interface AssignScopeToClientDeps {
  readonly audit: Audit;
}

export type AssignScopeToClientOutcome =
  | { kind: 'scope_not_found' }
  | { kind: 'client_not_found' }
  | TargetCeilingRefusal
  | { kind: 'client_scope_limit'; message: string }
  | { kind: 'ok'; assignments: AssignScopeToClientResponse; clientEtag: string };

// The `ETag` `GET …/clients/:id` answers, which hashes the client's scopes too:
// an assignment changes it, and a caller editing the client needs the new one.
async function clientEtagOf(tx: TenantScopedDatabase, clientId: string): Promise<string> {
  const read = await readClient(tx, clientId);
  if (read.kind === 'not_found') throw new Error(`client ${clientId} vanished mid-assignment`);
  return etagOf(clientWireShape(read.client));
}

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

  const client = await clientRepository(tx).byId(input.clientId);
  if (client === null) return { kind: 'client_not_found' };
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'scope.assign_to_client',
    client.serviceSubjectId,
    input,
    { type: 'scope', id: input.scopeId },
  );
  if (refused !== null) return refused;

  try {
    await clientScopeRepository(tx).assignOrUpdate(input.clientId, input.scopeId, input.assignment);
  } catch (error) {
    if (error instanceof ClientScopeLimitError) {
      return { kind: 'client_scope_limit', message: error.message };
    }
    throw error;
  }

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
    clientEtag: await clientEtagOf(tx, input.clientId),
  };
}

export interface UnassignScopeFromClientInput extends ClientCeilingCaller {
  readonly scopeId: string;
  readonly clientId: string;
}

export interface UnassignScopeFromClientDeps {
  readonly audit: Audit;
}

export type UnassignScopeFromClientOutcome =
  | { kind: 'scope_not_found' }
  | { kind: 'client_not_found' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | TargetCeilingRefusal
  | { kind: 'not_assigned' }
  | { kind: 'removed'; clientEtag: string };

/**
 * Removes a client's assignment of a scope — the inverse of
 * `assignScopeToClient`. Neither a `default` nor an `optional` assignment is
 * privileged over the other: both go, and `unassign` (@odudu/domain-tenant)
 * does not distinguish them.
 */
export async function unassignScopeFromClient(
  tx: TenantScopedDatabase,
  deps: UnassignScopeFromClientDeps,
  input: UnassignScopeFromClientInput,
): Promise<UnassignScopeFromClientOutcome> {
  const scope = await clientScopeRepository(tx).byId(input.scopeId);
  if (scope === null) return { kind: 'scope_not_found' };

  // `byId`, not a raw select: the one read that serves both the 404 below
  // and the guard that follows it, on the same row.
  const client = await clientRepository(tx).byId(input.clientId);
  if (client === null) return { kind: 'client_not_found' };
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'scope.unassign_from_client',
    client.serviceSubjectId,
    input,
    { type: 'scope', id: input.scopeId },
  );
  if (refused !== null) return refused;

  // Reads `builtinAdmin`, never `client_id` — the same check `amendClient`
  // (#/usecase/clients.ts) makes. The built-in admin client supports no
  // grant but `authorization_code`/`refresh_token`
  // (`provisionAdminClient`, protocol-oidc), and `/authorize` refuses any
  // scope this client is not assigned, `openid` included, its own default
  // (`scopesAreGrantable`) — so unassigning here can lock every
  // administrator of this tenant out of a fresh login.
  if (client.builtinAdmin) {
    const reason =
      `the scope ${scope.name} on ${client.clientId}, this tenant’s built-in ` +
      'admin client, cannot be unassigned: it could leave every administrator ' +
      'of this tenant locked out of /authorize';
    await deps.audit(tx, {
      action: 'scope.unassign_from_client',
      resourceType: 'scope',
      resourceId: input.scopeId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'builtin_admin_guarded', reason };
  }

  const removed = await clientScopeRepository(tx).unassign(input.clientId, input.scopeId);
  if (!removed) return { kind: 'not_assigned' };

  await deps.audit(tx, {
    action: 'scope.unassign_from_client',
    resourceType: 'scope',
    resourceId: input.scopeId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'removed', clientEtag: await clientEtagOf(tx, input.clientId) };
}

export interface ListScopeClientsInput {
  readonly tenantId: string;
  readonly scopeId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export type ListScopeClientsOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly ScopeClient[]; next: string | null };

const SCOPE_CLIENTS_COLLECTION = 'scope_clients';

// Keyed on the client's row id, and the cursor bound to the scope, so a page
// of one scope's clients never resumes another's.
export async function listScopeClients(
  tx: TenantScopedDatabase,
  input: ListScopeClientsInput,
): Promise<ListScopeClientsOutcome> {
  if ((await clientScopeRepository(tx).byId(input.scopeId)) === null) return { kind: 'not_found' };
  const filters = filterDigest({ scope: input.scopeId });
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      SCOPE_CLIENTS_COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await tx
    .select({
      id: clients.id,
      clientId: clients.clientId,
      name: clients.name,
      assignment: clientScopeAssignments.assignment,
    })
    .from(clientScopeAssignments)
    .innerJoin(clients, eq(clients.id, clientScopeAssignments.clientId))
    .where(
      and(
        eq(clientScopeAssignments.clientScopeId, input.scopeId),
        ...(after === undefined ? [] : [gt(clientScopeAssignments.clientId, after)]),
      ),
    )
    .orderBy(asc(clientScopeAssignments.clientId))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: SCOPE_CLIENTS_COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;
  return {
    kind: 'ok',
    items: page.map((row) => ({
      id: row.id,
      client_id: row.clientId,
      name: row.name,
      assignment: row.assignment,
    })),
    next,
  };
}
