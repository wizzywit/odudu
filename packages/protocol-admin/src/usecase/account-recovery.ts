import { requiredActionRepository } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  credentialRepository,
  generateOneTimePassword,
  hashPassword,
  loginFailureRepository,
  subjects,
  users,
} from '@odudu/domain-identity';
import { eq } from 'drizzle-orm';
import { refuseOverTargetCeiling, type TargetCeilingRefusal } from '#/usecase/subjects';

export interface AccountRecoveryAuditEvent {
  readonly action: 'subject.password_issue' | 'subject.lockout_clear';
  readonly resourceType: 'subject';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: AccountRecoveryAuditEvent) => Promise<void>;

export interface AccountRecoveryInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface IssuePasswordInput extends AccountRecoveryInput {
  readonly callerCapabilities: ReadonlySet<string>;
}

export interface AccountRecoveryDeps {
  readonly audit: Audit;
}

export interface IssuePasswordDeps extends AccountRecoveryDeps {
  /**
   * Spends every reset-password link still outstanding for the subject, as
   * a redeemed reset does. Injected because the links belong to
   * `@odudu/account`, which this package does not depend on.
   */
  readonly retireResetLinks: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
}

// A subject with no `users` row — a service or agent_instance subject — has
// no sign-in to recover, and is not found here. `lock` takes the subject
// row, so two concurrent issues serialize and the password the later one
// answers is the one in force.
async function isUserSubject(
  tx: TenantScopedDatabase,
  subjectId: string,
  lock: boolean,
): Promise<boolean> {
  const query = tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId));
  const found = lock ? await query.for('update') : await query;
  if (found.length === 0) return false;
  const user = await tx
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(eq(users.subjectId, subjectId));
  return user.length > 0;
}

export type IssuePasswordOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'issued'; password: string };

// The same write a redeemed reset link makes (`credentialRepository.setPassword`),
// with `update-password` owed and every other reset link retired, as a reset
// retires its siblings. The lockout is cleared: an administrator restoring
// access is not the attacker a lockout exists to slow down. Like a reset, it
// ends no session and revokes no grant. Never checked against the password
// policy: the policy governs a password somebody chooses, and the sign-in
// that spends this one only verifies it before parking on the change.
export async function issuePassword(
  tx: TenantScopedDatabase,
  deps: IssuePasswordDeps,
  input: IssuePasswordInput,
): Promise<IssuePasswordOutcome> {
  if (!(await isUserSubject(tx, input.subjectId, true))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.password_issue', input);
  if (refused !== null) return refused;

  const password = generateOneTimePassword();
  const hash = await hashPassword(password);
  const credentials = credentialRepository(tx);
  if ((await credentials.passwordFor(input.subjectId)) === null) {
    await credentials.insert({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      type: 'password',
      secret: { kind: 'password', hash },
    });
  } else {
    await credentials.setPassword(input.subjectId, hash);
  }
  await requiredActionRepository(tx).add(input.tenantId, input.subjectId, 'update-password');
  await loginFailureRepository(tx).clear(input.subjectId);
  await deps.retireResetLinks(tx, input.subjectId);

  await deps.audit(tx, {
    action: 'subject.password_issue',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'issued', password };
}

export type ClearLockoutOutcome = { kind: 'not_found' } | { kind: 'cleared' };

// Deletes the subject's `login_failures` row, which is what a correct
// password accepted by an unlocked account does — so the run of failures
// ends outright rather than the lock alone. Idempotent: a subject with
// nothing against it answers the same, and `detail.cleared` records
// whether a row actually went.
export async function clearLockout(
  tx: TenantScopedDatabase,
  deps: AccountRecoveryDeps,
  input: AccountRecoveryInput,
): Promise<ClearLockoutOutcome> {
  if (!(await isUserSubject(tx, input.subjectId, false))) return { kind: 'not_found' };

  const cleared = await loginFailureRepository(tx).clear(input.subjectId);

  await deps.audit(tx, {
    action: 'subject.lockout_clear',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { cleared },
  });

  return { kind: 'cleared' };
}
