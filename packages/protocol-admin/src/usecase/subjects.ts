import { requiredActionRepository } from '@odudu/authn-flows';
import { type Subject } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  subjectRepository,
  subjects,
  userRepository,
  users,
  type SubjectRecord,
} from '@odudu/domain-identity';
import { and, asc, eq, gt, like } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';

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
