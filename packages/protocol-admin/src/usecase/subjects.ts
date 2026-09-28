import { requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import {
  usernameSchema,
  type Credential,
  type Group,
  type ListSubjectsQuery,
  type Subject,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  groupRepository,
  roleRepository,
  roles,
  subjectGroups,
  subjectRoles,
} from '@odudu/domain-authz';
import {
  credentialRepository,
  isEmailAddress,
  passwordExpired,
  subjectRepository,
  subjects,
  userCredentials,
  userRepository,
  users,
  type CredentialType,
  type SubjectRecord,
} from '@odudu/domain-identity';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { isUuid } from '@odudu/kernel';
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { type SelectedFields } from 'drizzle-orm/pg-core';
import { redactedDiff } from '#/service/audit-detail';
import {
  capabilitiesOfGroupsAndAncestors,
  capabilitiesReachableFrom,
  holdersOf,
  overreach,
  targetOverreach,
} from '#/service/capability-ceiling';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { etagOf, requiredPrecondition } from '#/service/etag';
import { groupWireShape } from '#/service/group-wire';
import { amendableSubjectFields, refusalFor } from '#/service/subjects-patch';
import {
  guardLastAdministrator,
  type LastAdministratorRefusal,
} from '#/usecase/last-administrator';
import {
  prefixRangeConditions,
  requireSearchKey,
  type ListPosition,
} from '#/usecase/prefix-search';

const COLLECTION = 'subjects';

const SUBJECT_VIEW_COLUMNS = {
  id: subjects.id,
  type: subjects.type,
  disabledAt: subjects.disabledAt,
  createdAt: subjects.createdAt,
  username: users.username,
  email: users.email,
};

// The subject and its (possibly absent) user profile, joined into the one
// resource an admin caller reads. A service or agent_instance subject has
// no `users` row at all, hence the left join and the nullable fields.
export interface SubjectView {
  readonly id: string;
  readonly type: SubjectRecord['type'];
  readonly username: string | null;
  readonly email: string | null;
  readonly enabled: boolean;
  readonly createdAt: Date;
}

function subjectsJoinedWithUsers(tx: TenantScopedDatabase) {
  return tx
    .select(SUBJECT_VIEW_COLUMNS)
    .from(subjects)
    .leftJoin(users, eq(subjects.id, users.subjectId));
}

function narrowRow(row: Awaited<ReturnType<typeof subjectsJoinedWithUsers>>[number]): SubjectView {
  return {
    id: row.id,
    type: row.type as SubjectView['type'],
    username: row.username ?? null,
    email: row.email ?? null,
    enabled: row.disabledAt === null,
    createdAt: row.createdAt,
  };
}

export interface SubjectAuditEvent {
  readonly action:
    | 'subject.create'
    | 'subject.amend'
    | 'subject.delete'
    | 'subject.credential_delete'
    | 'subject.required_actions_set'
    | 'subject.roles_set'
    | 'subject.groups_set'
    | 'subject.profile_amend';
  readonly resourceType: 'subject';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: SubjectAuditEvent) => Promise<void>;

export interface TargetCeilingInput {
  readonly subjectId: string;
  /** The caller's own admin capabilities, resolved in the tenant its token was issued from. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface TargetCeilingRefusal {
  readonly kind: 'target_ceiling';
  readonly requested: readonly string[];
}

// `targetOverreach` (#/service/capability-ceiling.ts), with the refused row
// an attempted privilege escalation always gets, filed under the action the
// caller attempted — on the subject, unless `resource` names the row the
// action is filed on instead. Null when the caller covers the target. Every
// route that mutates a subject calls this first, under the subject's lock.
export async function refuseOverTargetCeiling<A extends string, R extends string = 'subject'>(
  tx: TenantScopedDatabase,
  audit: (
    tx: TenantScopedDatabase,
    event: {
      action: A;
      resourceType: R;
      resourceId: string;
      actorSubjectId: string;
      actorTenantId: string;
      actorClientId: string;
      outcome: 'refused';
      detail: Record<string, unknown>;
    },
  ) => Promise<void>,
  action: A,
  input: TargetCeilingInput,
  resource?: { readonly type: R; readonly id: string },
): Promise<TargetCeilingRefusal | null> {
  const denied = await targetOverreach(tx, input.subjectId, input.callerCapabilities);
  if (denied.length === 0) return null;
  await audit(tx, {
    action,
    resourceType: resource?.type ?? ('subject' as R),
    resourceId: resource?.id ?? input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'refused',
    detail: { denied },
  });
  return { kind: 'target_ceiling', requested: denied };
}

// The lock every mutation of one subject serialises on; false when there is
// none. `no key update` conflicts with itself, so two admin mutations still
// queue, but not with the key-share lock every insert referencing the
// subject takes: `FOR UPDATE` here deadlocks against a login that touched
// a session, or cleared its failures, and then inserts a row naming the
// subject. `deleteSubject`'s own delete still takes the full lock.
export async function lockSubjectRow(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .for('no key update');
  return rows.length > 0;
}

/** Every `listSubjectsQuerySchema` parameter except the page controls. */
export type SubjectFilters = Omit<ListSubjectsQuery, 'cursor' | 'limit'>;

export interface ListSubjectsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  /** A subject with no `users` row never matches a username or email search. */
  readonly filters: SubjectFilters;
}

export type ListSubjectsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly SubjectView[]; next: string | null };

type SearchKeyColumn = typeof users.usernameSearch | typeof users.emailSearch;

function searchOf(
  filters: SubjectFilters,
): { readonly column: SearchKeyColumn; readonly prefix: string } | undefined {
  if (filters.username !== undefined) {
    return { column: users.usernameSearch, prefix: filters.username };
  }
  if (filters.email !== undefined) return { column: users.emailSearch, prefix: filters.email };
  return undefined;
}

function exactFilterConditions(filters: SubjectFilters, tx: TenantScopedDatabase): SQL[] {
  const conditions: SQL[] = [];
  if (filters.enabled === 'true') conditions.push(isNull(subjects.disabledAt));
  if (filters.enabled === 'false') conditions.push(isNotNull(subjects.disabledAt));
  if (filters.role !== undefined) {
    const holders = tx
      .select({ id: subjectRoles.subjectId })
      .from(subjectRoles)
      .where(eq(subjectRoles.roleId, filters.role));
    conditions.push(inArray(subjects.id, holders));
  }
  if (filters.group !== undefined) {
    const members = tx
      .select({ id: subjectGroups.subjectId })
      .from(subjectGroups)
      .where(eq(subjectGroups.groupId, filters.group));
    conditions.push(inArray(subjects.id, members));
  }
  if (filters.capability !== undefined) {
    conditions.push(sql`${subjects.id} IN ${holdersOf(filters.capability)}`);
  }
  return conditions;
}

/**
 * The WHERE clause of the subjects listing, over `subjectListRows`, and so
 * also of its count, which passes no position.
 */
export async function subjectListConditions(
  tx: TenantScopedDatabase,
  filters: SubjectFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions = exactFilterConditions(filters, tx);
  const search = searchOf(filters);
  if (search === undefined) {
    if (after !== undefined) conditions.push(gt(subjects.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(tx, search.column, users.subjectId, search.prefix, position)),
  );
  return conditions;
}

/**
 * The subjects listing's FROM: `subjects` left-joined to `users`, whose
 * columns the search and the view read. Shared with its count.
 */
export function subjectListRows<T extends SelectedFields>(tx: TenantScopedDatabase, fields: T) {
  return tx.select(fields).from(subjects).leftJoin(users, eq(subjects.id, users.subjectId));
}

/** The subjects listing's order, which its keyset cursor and its count both follow. */
export function subjectListOrder(filters: SubjectFilters): SQL[] {
  const search = searchOf(filters);
  return search === undefined ? [asc(subjects.id)] : [asc(search.column), asc(users.subjectId)];
}

// A searched listing is one range scan of the search column's index
// (0073_list_indexes_subjects.sql): both bounds and the keyset are
// leakproof comparisons on that column, so row-level security leaves them
// in the index condition. `docs/phases/p4d.md` records the plan.
export async function listSubjects(
  tx: TenantScopedDatabase,
  input: ListSubjectsInput,
): Promise<ListSubjectsOutcome> {
  const filters = filterDigest(input.filters);
  const search = searchOf(input.filters);
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
    if (search !== undefined && decoded.sort === undefined) return { kind: 'invalid_cursor' };
    after = { id: decoded.after, sort: decoded.sort };
  }

  const conditions = await subjectListConditions(tx, input.filters, after);
  const searchKey = search?.column;
  const rows = await subjectListRows(tx, {
    ...SUBJECT_VIEW_COLUMNS,
    searchKey: searchKey ?? sql<null>`null`,
  })
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(...subjectListOrder(input.filters))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          ...(searchKey === undefined ? {} : { sort: requireSearchKey(last.searchKey) }),
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;

  return { kind: 'ok', items: page.map(narrowRow), next };
}

export type ReadSubjectOutcome = { kind: 'not_found' } | { kind: 'ok'; subject: SubjectView };

export async function readSubject(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ReadSubjectOutcome> {
  const rows = await subjectsJoinedWithUsers(tx).where(eq(subjects.id, subjectId));
  const row = rows[0];
  return row === undefined ? { kind: 'not_found' } : { kind: 'ok', subject: narrowRow(row) };
}

export interface ComposeUserSubjectInput {
  readonly tenantId: string;
  readonly username: string;
  readonly email: string | null;
}

// Shared by self-registration (`createAccount`, apps/server/src/app.ts) and
// administrative creation below, so the two doors cannot drift on what "a
// new subject" means: a subject, its user row, and the tenant's
// `default_for_new_subjects` roles. Self-registration adds a password
// credential on top of this; the admin door below adds an `update-password`
// required action instead.
export async function composeUserSubject(
  tx: TenantScopedDatabase,
  input: ComposeUserSubjectInput,
): Promise<{ subjectId: string }> {
  const subject = await subjectRepository(tx).create({ tenantId: input.tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId: input.tenantId,
    username: input.username,
    email: input.email,
  });
  const defaults = await roleRepository(tx).defaultsForTenant();
  for (const role of defaults) {
    await roleRepository(tx).assignToSubject(subject.id, role.id);
  }
  return { subjectId: subject.id };
}

export interface CreateSubjectInput {
  readonly tenantId: string;
  readonly username: string;
  readonly email: string | null;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateSubjectDeps {
  readonly audit: Audit;
}

// `users_username_unique` propagates out of `composeUserSubject` as a raw
// driver error rather than a returned outcome, the same shape
// `ClientIdConflictError` leaves `createClient` in (#/usecase/clients.ts):
// the unique-index violation has already aborted this transaction by the
// time it is caught, so there is nothing left here to return an outcome
// from. The route catches it outside `withTenant`.
export async function createSubject(
  tx: TenantScopedDatabase,
  deps: CreateSubjectDeps,
  input: CreateSubjectInput,
): Promise<SubjectView> {
  const { subjectId } = await composeUserSubject(tx, {
    tenantId: input.tenantId,
    username: input.username,
    email: input.email,
  });
  // No password field on this door: the operator conveys a channel to set
  // one, and the subject cannot complete a login until they do.
  await requiredActionRepository(tx).add(input.tenantId, subjectId, 'update-password');

  await deps.audit(tx, {
    action: 'subject.create',
    resourceType: 'subject',
    resourceId: subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const outcome = await readSubject(tx, subjectId);
  if (outcome.kind !== 'ok') {
    throw new Error(`subject ${subjectId} not found immediately after its own creation`);
  }
  return outcome.subject;
}

// The wire shape a caller reads back — the same mapping on a list, a `GET`
// and a `POST`'s response, so a subject read one way is never shaped
// differently from the same subject read another.
export function subjectWireShape(view: SubjectView): Subject {
  return {
    id: view.id,
    type: view.type,
    username: view.username,
    email: view.email,
    enabled: view.enabled,
    created_at: view.createdAt.toISOString(),
  };
}

export interface AmendSubjectInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendSubjectDeps {
  readonly audit: Audit;
}

export type AmendSubjectOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_required'; field: string }
  | { kind: 'precondition_failed' }
  | TargetCeilingRefusal
  | { kind: 'ok'; subject: SubjectView; etag: string }
  | LastAdministratorRefusal;

// Wrapped in `{ value }` rather than the bare type, so a present-but-null
// `email` and an untouched field both type-check as distinct from each
// other — `patch.email !== undefined` alone tells them apart, with no
// second `'email' in patch` check needed at the write site.
interface SubjectPatch {
  username?: { value: string };
  enabled?: { value: boolean };
  email?: { value: string | null };
}

// Locks `subjects` and, when it exists, `users` for the rest of the
// transaction — separately, never through the left join `readSubject`
// uses: PostgreSQL refuses `FOR UPDATE` on the nullable side of an outer
// join, which `users` always is here. Locking both is what makes the
// `If-Match` comparison below and the writes that follow it the only ones
// running against this subject, the same reasoning `amendClient`
// (#/usecase/clients.ts) locks its client and config rows for.
async function lockSubjectForAmend(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<{
  subject: typeof subjects.$inferSelect;
  user: typeof users.$inferSelect | null;
} | null> {
  // `no key update`, for the reason `lockSubjectRow` gives.
  const subjectRows = await tx
    .select()
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .for('no key update');
  const subject = subjectRows[0];
  if (subject === undefined) return null;
  const userRows = await tx
    .select()
    .from(users)
    .where(eq(users.subjectId, subjectId))
    .for('update');
  return { subject, user: userRows[0] ?? null };
}

function viewOfLocked(
  locked: NonNullable<Awaited<ReturnType<typeof lockSubjectForAmend>>>,
): SubjectView {
  return {
    id: locked.subject.id,
    type: locked.subject.type as SubjectView['type'],
    username: locked.user?.username ?? null,
    email: locked.user?.email ?? null,
    enabled: locked.subject.disabledAt === null,
    createdAt: locked.subject.createdAt,
  };
}

/**
 * Amends `email` and `enabled`, and `username` where the tenant's
 * `username_editable` is on. A username another subject holds propagates
 * as `users_username_unique`'s raw driver error, for the reason
 * `createSubject` gives; the route answers `409` outside the transaction.
 */
export async function amendSubject(
  tx: TenantScopedDatabase,
  deps: AmendSubjectDeps,
  input: AmendSubjectInput,
): Promise<AmendSubjectOutcome> {
  if (!('enabled' in input.values)) return amendSubjectUnguarded(tx, deps, input);
  return guardLastAdministrator(
    tx,
    {
      action: 'subject.amend',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => amendSubjectUnguarded(inner, deps, input),
  );
}

async function amendSubjectUnguarded(
  tx: TenantScopedDatabase,
  deps: AmendSubjectDeps,
  input: AmendSubjectInput,
): Promise<AmendSubjectOutcome> {
  const settings = await tenantSettingsRepository(tx).byId(input.tenantId);
  const policy = { usernameEditable: settings?.username_editable === true };
  const amendable = amendableSubjectFields(policy);
  for (const field of Object.keys(input.values)) {
    if (!amendable.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field, policy) ?? `${field} is not a subject field`,
      };
    }
  }

  const locked = await lockSubjectForAmend(tx, input.subjectId);
  if (locked === null) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.amend', input);
  if (refused !== null) return refused;

  // A rename must name the version it read: one administrator's rename
  // silently undoing another's is what the precondition exists to stop.
  const current = subjectWireShape(viewOfLocked(locked));
  const currentEtag = etagOf(current);
  const precondition = requiredPrecondition(input.ifMatch, currentEtag);
  if (precondition === 'failed') return { kind: 'precondition_failed' };
  if (precondition === 'required' && 'username' in input.values) {
    return { kind: 'precondition_required', field: 'username' };
  }

  // Every field is validated before any of them is written into `patch` —
  // a refusal below must leave every column, `disabled_at` included,
  // exactly as it was. `email`'s shape is checked here rather than left to
  // `userRepository.updateEmail`'s own throw, which a malformed address
  // would otherwise reach only after `enabled` had already been written.
  // Phase two writes only from `patch`, never re-reading `input.values` —
  // that is what keeps a field added later from being written inline
  // without going through this validation first.
  const patch: SubjectPatch = {};
  if ('username' in input.values) {
    const parsed = usernameSchema.safeParse(input.values.username);
    if (!parsed.success) {
      return {
        kind: 'invalid_value',
        field: 'username',
        description: 'username must be a non-empty string',
      };
    }
    if (locked.user === null) {
      return {
        kind: 'invalid_value',
        field: 'username',
        description: `subject ${input.subjectId} has no user profile to carry a username`,
      };
    }
    if (parsed.data !== locked.user.username) patch.username = { value: parsed.data };
  }
  if ('enabled' in input.values) {
    if (typeof input.values.enabled !== 'boolean') {
      return { kind: 'invalid_value', field: 'enabled', description: 'enabled must be a boolean' };
    }
    patch.enabled = { value: input.values.enabled };
  }
  if ('email' in input.values) {
    const value = input.values.email;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'email',
        description: 'email must be a string or null',
      };
    }
    if (locked.user === null) {
      return {
        kind: 'invalid_value',
        field: 'email',
        description: `subject ${input.subjectId} has no user profile to carry an email`,
      };
    }
    if (value !== null && !isEmailAddress(value)) {
      return {
        kind: 'invalid_value',
        field: 'email',
        description: `${JSON.stringify(value)} is not an address the email claim may carry`,
      };
    }
    patch.email = { value };
  }

  // A rename to the name the subject already has, with nothing else asked
  // of it, changes nothing and so records nothing.
  if ('username' in input.values && Object.keys(patch).length === 0) {
    return { kind: 'ok', subject: viewOfLocked(locked), etag: currentEtag };
  }

  if (patch.enabled !== undefined) {
    await subjectRepository(tx).setEnabled(input.subjectId, patch.enabled.value);
  }
  if (patch.email !== undefined) {
    await userRepository(tx).updateEmail(input.subjectId, patch.email.value);
  }
  if (patch.username !== undefined) {
    await userRepository(tx).updateUsername(input.subjectId, patch.username.value);
  }

  const after = await readSubject(tx, input.subjectId);
  if (after.kind !== 'ok') {
    throw new Error(`subject ${input.subjectId} not found immediately after its own amendment`);
  }
  const afterWire = subjectWireShape(after.subject);
  await deps.audit(tx, {
    action: 'subject.amend',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('subject', current, afterWire),
  });
  return { kind: 'ok', subject: after.subject, etag: etagOf(afterWire) };
}

export interface DeleteSubjectInput {
  readonly subjectId: string;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteSubjectDeps {
  readonly audit: Audit;
}

export type DeleteSubjectOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'deleted' } | LastAdministratorRefusal;

// The delete itself is one statement: every table that names a subject
// (users, user_credentials, sessions, token_grants, subject_roles, …)
// cascades on it, and clients_service_subject_fk (0063_service_subject_fk.sql)
// is the one exception, which now detaches rather than blocks it.
export async function deleteSubject(
  tx: TenantScopedDatabase,
  deps: DeleteSubjectDeps,
  input: DeleteSubjectInput,
): Promise<DeleteSubjectOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'subject.delete',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => deleteSubjectUnguarded(inner, deps, input),
  );
}

async function deleteSubjectUnguarded(
  tx: TenantScopedDatabase,
  deps: DeleteSubjectDeps,
  input: DeleteSubjectInput,
): Promise<DeleteSubjectOutcome> {
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.delete', input);
  if (refused !== null) return refused;

  const rows = await tx.delete(subjects).where(eq(subjects.id, input.subjectId)).returning({
    id: subjects.id,
  });
  if (rows.length === 0) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'subject.delete',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'deleted' };
}

// `password-history` is excluded here too: `listCredentials` filters it out
// of every row it reads, so nothing that reaches this type could carry it.
export type WireCredentialType = Exclude<CredentialType, 'password-history'>;

export interface CredentialView {
  readonly id: string | null;
  readonly type: WireCredentialType;
  readonly createdAt: Date;
  readonly expired?: boolean;
  readonly recoveryCodeCount?: number;
}

export interface ListCredentialsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly now: Date;
}

export type ListCredentialsOutcome =
  { kind: 'not_found' } | { kind: 'ok'; items: readonly CredentialView[] };

// `recovery-code` rows are collapsed into one entry carrying a count —
// see credentialSchema's own comment (@odudu/contracts) for why a per-row
// listing would answer the wrong question. `password-history` is left out
// entirely: it is never a credential a caller reads or deletes.
export async function listCredentials(
  tx: TenantScopedDatabase,
  input: ListCredentialsInput,
): Promise<ListCredentialsOutcome> {
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (subjectRows.length === 0) return { kind: 'not_found' };

  const rows = await tx
    .select({
      id: userCredentials.id,
      type: userCredentials.type,
      createdAt: userCredentials.createdAt,
    })
    .from(userCredentials)
    .where(
      and(
        eq(userCredentials.subjectId, input.subjectId),
        ne(userCredentials.type, 'password-history'),
      ),
    );

  const settings = await tenantSettingsRepository(tx).byId(input.tenantId);
  const maxAgeDays =
    typeof settings?.password_max_age_days === 'number' ? settings.password_max_age_days : 0;

  const items: CredentialView[] = [];
  const recoveryRows = rows.filter((row) => row.type === 'recovery-code');
  for (const row of rows) {
    if (row.type === 'recovery-code') continue;
    items.push({
      id: row.id,
      // The query's own `ne(userCredentials.type, 'password-history')`
      // already rules this out; the cast tells the type system what the
      // predicate above narrowed row.type to at runtime.
      type: row.type as WireCredentialType,
      createdAt: row.createdAt,
      ...(row.type === 'password'
        ? { expired: passwordExpired({ createdAt: row.createdAt }, maxAgeDays, input.now) }
        : {}),
    });
  }
  if (recoveryRows.length > 0) {
    const mostRecent = recoveryRows.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const count = await credentialRepository(tx).countUnspentRecoveryCodes(input.subjectId);
    items.push({
      id: null,
      type: 'recovery-code',
      createdAt: mostRecent.createdAt,
      recoveryCodeCount: count,
    });
  }

  return { kind: 'ok', items };
}

export function credentialWireShape(view: CredentialView): Credential {
  return {
    ...(view.id === null ? {} : { id: view.id }),
    type: view.type,
    created_at: view.createdAt.toISOString(),
    ...(view.expired === undefined ? {} : { expired: view.expired }),
    ...(view.recoveryCodeCount === undefined
      ? {}
      : { recovery_code_count: view.recoveryCodeCount }),
  };
}

export interface DeleteCredentialInput {
  readonly subjectId: string;
  readonly credentialId: string;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface DeleteCredentialDeps {
  readonly audit: Audit;
}

export type DeleteCredentialOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused'; reason: string }
  | TargetCeilingRefusal
  | { kind: 'deleted' };

// `password` and `password-history` are refused: the first has its own
// rotation surface (a password change, never a bare delete — a subject
// with no password credential at all cannot complete the `password` login
// step), and the second is not a credential this door exposes at all.
export async function deleteCredential(
  tx: TenantScopedDatabase,
  deps: DeleteCredentialDeps,
  input: DeleteCredentialInput,
): Promise<DeleteCredentialOutcome> {
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.credential_delete', input);
  if (refused !== null) return refused;

  const rows = await tx
    .select({
      id: userCredentials.id,
      type: userCredentials.type,
      subjectId: userCredentials.subjectId,
    })
    .from(userCredentials)
    .where(eq(userCredentials.id, input.credentialId))
    .for('update');
  const row = rows[0];
  if (row?.subjectId !== input.subjectId) return { kind: 'not_found' };
  if (row.type === 'password' || row.type === 'password-history') {
    return {
      kind: 'refused',
      reason: `a ${row.type} credential cannot be removed through this door`,
    };
  }

  await credentialRepository(tx).deleteOne(row.id);

  await deps.audit(tx, {
    action: 'subject.credential_delete',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });
  return { kind: 'deleted' };
}

export interface SetRequiredActionsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly actions: readonly RequiredAction[];
  readonly ifMatch: string | undefined;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetRequiredActionsDeps {
  readonly audit: Audit;
}

export type SetRequiredActionsOutcome =
  | { kind: 'not_found' }
  | TargetCeilingRefusal
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; actions: readonly RequiredAction[]; etag: string };

// Sorted before it is hashed, never as it is sent: `pendingFor` imposes no
// order, so two reads of an unchanged set would otherwise disagree about
// the `ETag` they answer.
function requiredActionsEtag(actions: readonly RequiredAction[]): string {
  return etagOf({ actions: [...actions].sort() });
}

export type ReadRequiredActionsOutcome =
  { kind: 'not_found' } | { kind: 'ok'; actions: readonly RequiredAction[]; etag: string };

export async function readRequiredActions(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ReadRequiredActionsOutcome> {
  const subject = await subjectRepository(tx).byId(subjectId);
  if (subject === null) return { kind: 'not_found' };
  const actions = await requiredActionRepository(tx).pendingFor(subjectId);
  return { kind: 'ok', actions, etag: requiredActionsEtag(actions) };
}

/** Replaces a subject's required actions wholesale — an action left out is one the caller clears. */
export async function setRequiredActions(
  tx: TenantScopedDatabase,
  deps: SetRequiredActionsDeps,
  input: SetRequiredActionsInput,
): Promise<SetRequiredActionsOutcome> {
  // Locked as a mutex for the delete-then-insert below: under READ
  // COMMITTED, two concurrent replacements with no lock each delete a
  // snapshot the other's inserts are invisible to, and both commit —
  // leaving the union of the two requests rather than either one alone.
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(
    tx,
    deps.audit,
    'subject.required_actions_set',
    input,
  );
  if (refused !== null) return refused;

  // Compared under the lock taken above, so the set it hashes is the set
  // the replacement below overwrites.
  const current = await requiredActionRepository(tx).pendingFor(input.subjectId);
  const precondition = requiredPrecondition(input.ifMatch, requiredActionsEtag(current));
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  await requiredActionRepository(tx).replaceAll(input.tenantId, input.subjectId, input.actions);

  await deps.audit(tx, {
    action: 'subject.required_actions_set',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const actions = await requiredActionRepository(tx).pendingFor(input.subjectId);
  return { kind: 'ok', actions, etag: requiredActionsEtag(actions) };
}

export interface RoleAssignment {
  readonly id: string;
  readonly name: string;
}

export interface SetRolesInput {
  readonly subjectId: string;
  readonly roleIds: readonly string[];
  /**
   * The caller's own admin-client capability names, expanded through
   * `role_composites` and resolved against the caller's own issuer tenant,
   * never the target tenant a cross-tenant system admin may differ from.
   * Computed by the route (`#/index.ts`, the same way
   * `AuthorizeAdminDeps.effectiveRoles` is) — this transaction is scoped to
   * the target tenant and cannot resolve a different one.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface SetRolesDeps {
  readonly audit: Audit;
}

export type SetRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'capability_ceiling'; requested: readonly string[] }
  | TargetCeilingRefusal
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string }
  | LastAdministratorRefusal;

export type ReadSubjectRolesOutcome =
  { kind: 'not_found' } | { kind: 'ok'; roles: readonly RoleAssignment[]; etag: string };

// Ordered by id so the list, and the `ETag` over it, are the same on every
// read of an unchanged assignment.
async function assignedRoles(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<readonly RoleAssignment[]> {
  return tx
    .select({ id: roles.id, name: roles.name })
    .from(subjectRoles)
    .innerJoin(roles, eq(subjectRoles.roleId, roles.id))
    .where(eq(subjectRoles.subjectId, subjectId))
    .orderBy(asc(roles.id));
}

export async function readSubjectRoles(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ReadSubjectRolesOutcome> {
  const subject = await subjectRepository(tx).byId(subjectId);
  if (subject === null) return { kind: 'not_found' };
  const assigned = await assignedRoles(tx, subjectId);
  return { kind: 'ok', roles: assigned, etag: etagOf({ items: assigned }) };
}

// The capability ceiling (CWE-269): a caller may never hand out authority
// it does not itself hold. `roleIds` is expanded through `role_composites`
// to the admin-client capability names it would actually grant — not
// merely the roles named — and compared against the caller's own, expanded
// the same way, so a composite that nests `tenant-admin` rather than naming
// it cannot smuggle the assignment past a name check on the request body.
export async function setRoles(
  tx: TenantScopedDatabase,
  deps: SetRolesDeps,
  input: SetRolesInput,
): Promise<SetRolesOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'subject.roles_set',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => setRolesUnguarded(inner, deps, input),
  );
}

async function setRolesUnguarded(
  tx: TenantScopedDatabase,
  deps: SetRolesDeps,
  input: SetRolesInput,
): Promise<SetRolesOutcome> {
  // Locked for the same reason setRequiredActions locks its subject row:
  // a mutex around the delete-then-insert below, so two concurrent
  // replacements serialise instead of each committing a partial view of
  // the other's write.
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.roles_set', input);
  if (refused !== null) return refused;

  // Under the same lock the replacement runs under, so the assignment this
  // hashes is the assignment being overwritten.
  const precondition = requiredPrecondition(
    input.ifMatch,
    etagOf({ items: await assignedRoles(tx, input.subjectId) }),
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

  const requestedCapabilities = await capabilitiesReachableFrom(tx, uniqueRoleIds);
  const denied = overreach(requestedCapabilities, input.callerCapabilities);
  if (denied.length > 0) {
    // General refusal auditing is not in this phase, but an attempted
    // privilege escalation is the one refusal worth a row of its own: it
    // is the whole reason this ceiling exists (CWE-269).
    await deps.audit(tx, {
      action: 'subject.roles_set',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: denied };
  }

  await tx.delete(subjectRoles).where(eq(subjectRoles.subjectId, input.subjectId));
  for (const roleId of uniqueRoleIds) {
    await roleRepository(tx).assignToSubject(input.subjectId, roleId);
  }

  await deps.audit(tx, {
    action: 'subject.roles_set',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const assigned = await assignedRoles(tx, input.subjectId);
  return { kind: 'ok', roles: assigned, etag: etagOf({ items: assigned }) };
}

export interface SetSubjectGroupsInput {
  readonly subjectId: string;
  readonly groupIds: readonly string[];
  /** See `SetRolesInput.callerCapabilities` — the same ceiling. */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type SetSubjectGroupsOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_group'; groupIds: readonly string[] }
  | { kind: 'capability_ceiling'; requested: readonly string[] }
  | TargetCeilingRefusal
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; groups: readonly Group[]; etag: string }
  | LastAdministratorRefusal;

export type ReadSubjectGroupsOutcome =
  { kind: 'not_found' } | { kind: 'ok'; groups: readonly Group[]; etag: string };

// The tag is over the body GET answers, so a reparent that rewrites a
// member's `path` changes it even though the membership did not.
function subjectGroupsEtag(memberships: readonly Group[]): string {
  return etagOf({ items: memberships });
}

async function memberGroups(tx: TenantScopedDatabase, subjectId: string): Promise<Group[]> {
  return (await groupRepository(tx).groupsOfSubject(subjectId)).map(groupWireShape);
}

export async function readSubjectGroups(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ReadSubjectGroupsOutcome> {
  const subject = await subjectRepository(tx).byId(subjectId);
  if (subject === null) return { kind: 'not_found' };
  const memberships = await memberGroups(tx, subjectId);
  return { kind: 'ok', groups: memberships, etag: subjectGroupsEtag(memberships) };
}

// The capability ceiling (CWE-269) over membership rather than assignment:
// joining a group grants every role mapped to it or its ancestors, so the
// whole resulting set is measured the way `effectiveRoles` would resolve it
// and compared against the caller's own — the same rule `setRoles` applies.
export async function setSubjectGroups(
  tx: TenantScopedDatabase,
  deps: SetRolesDeps,
  input: SetSubjectGroupsInput,
): Promise<SetSubjectGroupsOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'subject.groups_set',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => setSubjectGroupsUnguarded(inner, deps, input),
  );
}

async function setSubjectGroupsUnguarded(
  tx: TenantScopedDatabase,
  deps: SetRolesDeps,
  input: SetSubjectGroupsInput,
): Promise<SetSubjectGroupsOutcome> {
  // Locked for the same reason `setRoles` locks it: the delete-then-insert
  // below is serialised against a concurrent replacement.
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.groups_set', input);
  if (refused !== null) return refused;

  const current = await memberGroups(tx, input.subjectId);
  const precondition = requiredPrecondition(input.ifMatch, subjectGroupsEtag(current));
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const repository = groupRepository(tx);
  const missing: string[] = [];
  // Keyed by the id the row holds: a uuid matches in either letter case,
  // so two spellings of one id are one membership.
  const found = new Set<string>();
  for (const groupId of input.groupIds) {
    // `groups.id` is a `uuid` column; a non-uuid id is missing, not a 500.
    const group = isUuid(groupId) ? await repository.byId(groupId) : null;
    if (group === null) missing.push(groupId);
    else found.add(group.id);
  }
  if (missing.length > 0) return { kind: 'unknown_group', groupIds: [...new Set(missing)] };
  const uniqueGroupIds = [...found];

  const requestedCapabilities = await capabilitiesOfGroupsAndAncestors(tx, uniqueGroupIds);
  const denied = overreach(requestedCapabilities, input.callerCapabilities);
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'subject.groups_set',
      resourceType: 'subject',
      resourceId: input.subjectId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: denied };
  }

  await repository.setSubjectGroups(input.subjectId, uniqueGroupIds);
  const updated = await memberGroups(tx, input.subjectId);

  await deps.audit(tx, {
    action: 'subject.groups_set',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff(
      'subject',
      { group_ids: current.map((group) => group.id) },
      { group_ids: updated.map((group) => group.id) },
    ),
  });

  return { kind: 'ok', groups: updated, etag: subjectGroupsEtag(updated) };
}
