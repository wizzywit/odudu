import { type SessionLifespans } from '@odudu/authn-flows';
import { type BulkSubjectsRequest } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { endAllSessions, type Audit as SessionAudit } from '#/usecase/sessions';
import { amendSubject, deleteSubject, type Audit as SubjectAudit } from '#/usecase/subjects';

/** Runs `fn` in a transaction of its own, bound to the target tenant. */
export type InTransaction = <T>(fn: (tx: TenantScopedDatabase) => Promise<T>) => Promise<T>;

export interface BulkSubjectsDeps {
  readonly inTransaction: InTransaction;
  readonly subjectAudit: SubjectAudit;
  readonly sessionAudit: SessionAudit;
  readonly kek: Uint8Array;
}

export interface BulkSubjectsInput {
  readonly tenantId: string;
  readonly action: BulkSubjectsRequest['action'];
  readonly ids: readonly string[];
  readonly callerCapabilities: ReadonlySet<string>;
  readonly lifespans: SessionLifespans;
  readonly issuer: string;
  readonly now: Date;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type BulkSubjectOutcome =
  | { readonly id: string; readonly kind: 'done' }
  | { readonly id: string; readonly kind: 'ended'; readonly ended: number }
  | { readonly id: string; readonly kind: 'not_found' }
  | { readonly id: string; readonly kind: 'target_ceiling'; readonly requested: readonly string[] }
  | { readonly id: string; readonly kind: 'last_administrator'; readonly reason: string };

async function applyOne(
  tx: TenantScopedDatabase,
  deps: BulkSubjectsDeps,
  input: BulkSubjectsInput,
  id: string,
): Promise<BulkSubjectOutcome> {
  const actor = { ...input, subjectId: id };
  if (input.action === 'end-sessions') {
    const outcome = await endAllSessions(tx, { audit: deps.sessionAudit, kek: deps.kek }, actor);
    return outcome.kind === 'ended'
      ? { id, kind: 'ended', ended: outcome.ended }
      : { id, ...outcome };
  }
  if (input.action === 'delete') {
    const outcome = await deleteSubject(tx, { audit: deps.subjectAudit }, actor);
    return outcome.kind === 'deleted' ? { id, kind: 'done' } : { id, ...outcome };
  }
  const outcome = await amendSubject(
    tx,
    { audit: deps.subjectAudit },
    { ...actor, values: { enabled: input.action === 'enable' }, ifMatch: undefined },
  );
  switch (outcome.kind) {
    case 'ok':
      return { id, kind: 'done' };
    case 'not_found':
    case 'target_ceiling':
    case 'last_administrator':
      return { id, ...outcome };
    default:
      throw new Error(`protocol-admin: a bulk ${input.action} of ${id} answered ${outcome.kind}`);
  }
}

// Each id is the single-subject door exactly, in a transaction of its own:
// its ceilings, its last-administrator guard and its audit row apply to it
// alone, and one refused id leaves the others as they were. A repeated id
// is answered once.
export async function bulkSubjects(
  deps: BulkSubjectsDeps,
  input: BulkSubjectsInput,
): Promise<readonly BulkSubjectOutcome[]> {
  const outcomes: BulkSubjectOutcome[] = [];
  for (const id of new Set(input.ids.map((raw) => raw.toLowerCase()))) {
    outcomes.push(await deps.inTransaction((tx) => applyOne(tx, deps, input, id)));
  }
  return outcomes;
}
