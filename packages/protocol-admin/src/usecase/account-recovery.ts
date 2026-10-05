import { requiredActionRepository } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  credentialRepository,
  generateOneTimePassword,
  hashPassword,
  isLockedOut,
  loginFailureRepository,
  users,
  type LoginFailureRecord,
} from '@odudu/domain-identity';
import { eq } from 'drizzle-orm';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

export interface AccountRecoveryAuditEvent {
  readonly action:
    'subject.password_issue' | 'subject.lockout_clear' | 'subject.recovery_codes_revoke';
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
  readonly callerCapabilities: ReadonlySet<string>;
}

export interface AccountRecoveryDeps {
  readonly audit: Audit;
}

export interface IssuePasswordDeps extends AccountRecoveryDeps {
  /**
   * Spends every reset-password link still outstanding for the subject, as
   * a redeemed reset does. Injected because the links belong to
   * `@odudu/account`, which this package does not import in production code.
   */
  readonly retireResetLinks: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
}

// A subject with no `users` row — a service or agent_instance subject — has
// no sign-in to recover, and is not found here. The subject row is locked,
// as every mutation of one subject locks it, so two concurrent issues
// serialize and the password the later one answers is the one in force.
async function isUserSubject(tx: TenantScopedDatabase, subjectId: string): Promise<boolean> {
  if (!(await lockSubjectRow(tx, subjectId))) return false;
  const user = await tx
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(eq(users.subjectId, subjectId));
  return user.length > 0;
}

export type IssuePasswordOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'issued'; password: string };

// The same write a redeemed reset link makes (`credentialRepository.setPassword`),
// with `update-password` owed and every other password-setting link retired, as a reset
// retires its siblings. The lockout is cleared: an administrator restoring
// access is not the attacker a lockout exists to slow down. Like a reset, it
// ends no session and revokes no grant. Never checked against the password
// policy: the policy governs a password somebody chooses, and the sign-in
// that spends this one only verifies it before parking on the change.
export async function issuePassword(
  tx: TenantScopedDatabase,
  deps: IssuePasswordDeps,
  input: AccountRecoveryInput,
): Promise<IssuePasswordOutcome> {
  if (!(await isUserSubject(tx, input.subjectId))) return { kind: 'not_found' };
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

export type ClearLockoutOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'cleared' };

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
  if (!(await isUserSubject(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.lockout_clear', input);
  if (refused !== null) return refused;

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

export type ReadLockoutOutcome =
  { kind: 'not_found' } | { kind: 'ok'; record: LoginFailureRecord; locked: boolean };

// A read, so the subject row is not locked: it only has to be a user.
export async function readLockout(
  tx: TenantScopedDatabase,
  input: { readonly subjectId: string; readonly now: Date },
): Promise<ReadLockoutOutcome> {
  const user = await tx
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(eq(users.subjectId, input.subjectId));
  if (user.length === 0) return { kind: 'not_found' };
  const record = await loginFailureRepository(tx).forSubject(input.subjectId);
  return { kind: 'ok', record, locked: isLockedOut(record, input.now) };
}

export type RevokeRecoveryCodesOutcome =
  { kind: 'not_found' } | TargetCeilingRefusal | { kind: 'revoked' };

// Spent codes go too: ADR 0021 keeps a spent code's row, and a set that is
// revoked is revoked whole. Idempotent, with `detail.revoked` saying how
// many rows went.
export async function revokeRecoveryCodes(
  tx: TenantScopedDatabase,
  deps: AccountRecoveryDeps,
  input: AccountRecoveryInput,
): Promise<RevokeRecoveryCodesOutcome> {
  if (!(await isUserSubject(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(
    tx,
    deps.audit,
    'subject.recovery_codes_revoke',
    input,
  );
  if (refused !== null) return refused;

  const revoked = await credentialRepository(tx).deleteRecoveryCodes(input.subjectId);

  await deps.audit(tx, {
    action: 'subject.recovery_codes_revoke',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { revoked },
  });

  return { kind: 'revoked' };
}
