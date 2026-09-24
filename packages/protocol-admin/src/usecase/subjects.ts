import { requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import { type Credential, type Subject } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository, roles, rolesReachableFrom, subjectRoles } from '@odudu/domain-authz';
import {
  credentialRepository,
  passwordExpired,
  subjectRepository,
  subjects,
  userCredentials,
  userRepository,
  users,
  type CredentialType,
  type SubjectRecord,
} from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, tenantSettingsRepository } from '@odudu/domain-tenant';
import { and, asc, eq, gt, inArray, like, ne } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';

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
    | 'subject.roles_set';
  readonly resourceType: 'subject';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: SubjectAuditEvent) => Promise<void>;

export interface ListSubjectsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  /** A username prefix. A subject with no `users` row never matches one. */
  readonly search: string | undefined;
}

export type ListSubjectsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly SubjectView[]; next: string | null };

export async function listSubjects(
  tx: TenantScopedDatabase,
  input: ListSubjectsInput,
): Promise<ListSubjectsOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const conditions = [
    ...(after === undefined ? [] : [gt(subjects.id, after)]),
    // `like` with no wildcard in the operand escapes nothing, so a
    // caller's `_`/`%` is honoured as a wildcard rather than literal text —
    // acceptable here because the result is still scoped to this tenant by
    // row-level security, never a query a caller can widen past that.
    ...(input.search === undefined ? [] : [like(users.username, `${input.search}%`)]),
  ];

  const rows = await subjectsJoinedWithUsers(tx)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(subjects.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map(narrowRow);
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

  await deps.audit({
    action: 'subject.create',
    resourceType: 'subject',
    resourceId: subjectId,
    actorSubjectId: input.actorSubjectId,
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
  readonly subjectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
}

export interface AmendSubjectDeps {
  readonly audit: Audit;
}

const AMENDABLE_SUBJECT_FIELDS = ['email', 'enabled'];

export type AmendSubjectOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; subject: SubjectView; etag: string };

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
  const subjectRows = await tx
    .select()
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .for('update');
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

/** Amends `email` and `enabled` — the only two fields a subject exposes to a general amendment. */
export async function amendSubject(
  tx: TenantScopedDatabase,
  deps: AmendSubjectDeps,
  input: AmendSubjectInput,
): Promise<AmendSubjectOutcome> {
  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_SUBJECT_FIELDS.includes(field)) {
      return { kind: 'refused_field', field };
    }
  }

  const locked = await lockSubjectForAmend(tx, input.subjectId);
  if (locked === null) return { kind: 'not_found' };

  const currentEtag = etagOf(subjectWireShape(viewOfLocked(locked)));
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  if ('enabled' in input.values) {
    if (typeof input.values.enabled !== 'boolean') {
      return { kind: 'invalid_value', field: 'enabled', description: 'enabled must be a boolean' };
    }
    await subjectRepository(tx).setEnabled(input.subjectId, input.values.enabled);
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
    await userRepository(tx).updateEmail(input.subjectId, value);
  }

  await deps.audit({
    action: 'subject.amend',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
  });

  const after = await readSubject(tx, input.subjectId);
  if (after.kind !== 'ok') {
    throw new Error(`subject ${input.subjectId} not found immediately after its own amendment`);
  }
  return { kind: 'ok', subject: after.subject, etag: etagOf(subjectWireShape(after.subject)) };
}

export interface DeleteSubjectInput {
  readonly subjectId: string;
  readonly actorSubjectId: string;
}

export interface DeleteSubjectDeps {
  readonly audit: Audit;
}

export type DeleteSubjectOutcome = { kind: 'not_found' } | { kind: 'deleted' };

// The delete itself is one statement: every table that names a subject
// (users, user_credentials, sessions, token_grants, subject_roles, …)
// cascades on it, and clients_service_subject_fk (0063_service_subject_fk.sql)
// is the one exception, which now detaches rather than blocks it.
export async function deleteSubject(
  tx: TenantScopedDatabase,
  deps: DeleteSubjectDeps,
  input: DeleteSubjectInput,
): Promise<DeleteSubjectOutcome> {
  const rows = await tx.delete(subjects).where(eq(subjects.id, input.subjectId)).returning({
    id: subjects.id,
  });
  if (rows.length === 0) return { kind: 'not_found' };

  await deps.audit({
    action: 'subject.delete',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
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
  readonly actorSubjectId: string;
}

export interface DeleteCredentialDeps {
  readonly audit: Audit;
}

export type DeleteCredentialOutcome =
  { kind: 'not_found' } | { kind: 'refused'; reason: string } | { kind: 'deleted' };

// `password` and `password-history` are refused: the first has its own
// rotation surface (a password change, never a bare delete — a subject
// with no password credential at all cannot complete the `password` login
// step), and the second is not a credential this door exposes at all.
export async function deleteCredential(
  tx: TenantScopedDatabase,
  deps: DeleteCredentialDeps,
  input: DeleteCredentialInput,
): Promise<DeleteCredentialOutcome> {
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

  await deps.audit({
    action: 'subject.credential_delete',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
  });
  return { kind: 'deleted' };
}

export interface SetRequiredActionsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly actions: readonly RequiredAction[];
  readonly actorSubjectId: string;
}

export interface SetRequiredActionsDeps {
  readonly audit: Audit;
}

export type SetRequiredActionsOutcome =
  { kind: 'not_found' } | { kind: 'ok'; actions: readonly RequiredAction[] };

/** Replaces a subject's required actions wholesale — an action left out is one the caller clears. */
export async function setRequiredActions(
  tx: TenantScopedDatabase,
  deps: SetRequiredActionsDeps,
  input: SetRequiredActionsInput,
): Promise<SetRequiredActionsOutcome> {
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (subjectRows.length === 0) return { kind: 'not_found' };

  await requiredActionRepository(tx).replaceAll(input.tenantId, input.subjectId, input.actions);

  await deps.audit({
    action: 'subject.required_actions_set',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ok', actions: await requiredActionRepository(tx).pendingFor(input.subjectId) };
}

export interface RoleAssignment {
  readonly id: string;
  readonly name: string;
}

export interface SetRolesInput {
  readonly subjectId: string;
  readonly roleIds: readonly string[];
  /**
   * The caller's own admin-client capability names, already expanded
   * through `role_composites` and already resolved against the caller's
   * own issuer tenant — never the target tenant, which may differ from it
   * on a cross-tenant system-admin call. Computed by the route (`#/index.ts`
   * wires it the same way `AuthorizeAdminDeps.effectiveRoles` is), because
   * this transaction is scoped to the target tenant and cannot resolve a
   * different one.
   */
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
}

export interface SetRolesDeps {
  readonly audit: Audit;
}

export type SetRolesOutcome =
  | { kind: 'not_found' }
  | { kind: 'unknown_role'; roleIds: readonly string[] }
  | { kind: 'capability_ceiling'; requested: readonly string[] }
  | { kind: 'ok'; roles: readonly RoleAssignment[] };

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
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (subjectRows.length === 0) return { kind: 'not_found' };

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

  const reachable = await rolesReachableFrom(tx, uniqueRoleIds);
  const requestedCapabilities = new Set(
    reachable.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name),
  );
  const overreach = [...requestedCapabilities].filter(
    (capability) => !input.callerCapabilities.has(capability),
  );
  if (overreach.length > 0) {
    return { kind: 'capability_ceiling', requested: overreach };
  }

  await tx.delete(subjectRoles).where(eq(subjectRoles.subjectId, input.subjectId));
  for (const roleId of uniqueRoleIds) {
    await roleRepository(tx).assignToSubject(input.subjectId, roleId);
  }

  await deps.audit({
    action: 'subject.roles_set',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ok', roles: found };
}
