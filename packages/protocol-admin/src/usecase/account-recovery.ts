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

export interface AccountRecoveryDeps {
  readonly audit: Audit;
}

// The subject row is locked, so two concurrent issues serialize and the
// password the later one answers is the one in force. A subject with no
// `users` row — a service or agent_instance subject — has no sign-in to
// recover, and is not found here.
async function lockUserSubject(tx: TenantScopedDatabase, subjectId: string): Promise<boolean> {
  const locked = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .for('update');
  if (locked.length === 0) return false;
  const user = await tx
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(eq(users.subjectId, subjectId));
  return user.length > 0;
}

export type IssuePasswordOutcome = { kind: 'not_found' } | { kind: 'issued'; password: string };

// The same write a redeemed reset link makes (`credentialRepository.setPassword`),
// with `update-password` owed so the subject replaces it at the next sign-in —
// the shape `odudu seed admin` gives a first administrator. Like a reset, it
// ends no session and revokes no grant; `DELETE …/subjects/{id}/sessions` is
// the separate door for that. Never checked against the tenant's password
// policy: the policy governs a password somebody chooses, and the login
// that spends this one only verifies it before parking on the change.
export async function issuePassword(
  tx: TenantScopedDatabase,
  deps: AccountRecoveryDeps,
  input: AccountRecoveryInput,
): Promise<IssuePasswordOutcome> {
  if (!(await lockUserSubject(tx, input.subjectId))) return { kind: 'not_found' };

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
  const found = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (found.length === 0) return { kind: 'not_found' };

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
