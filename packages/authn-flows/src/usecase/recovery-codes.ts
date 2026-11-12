import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { credentialRepository, hashPassword, subjectRepository } from '@odudu/domain-identity';
import { requiredActionRepository } from '#/repository/required-actions';
import { type RequiredAction } from '#/schema/required-action';
import { generateRecoveryCodes, normaliseRecoveryCode } from '#/service/authenticators/recovery';
import { type RecoveryCodesOffer } from '#/view/recovery-codes-html';

export interface IssueRecoveryCodes {
  tenantId: string;
  subjectId: string;
  // Leave a set the subject already holds alone and say so, for a caller that
  // must ask before replacing it.
  keepHeld?: boolean;
}

export type BeginRecoveryCodesOutcome =
  { kind: 'issued'; offer: RecoveryCodesOffer } | { kind: 'no_second_factor' } | { kind: 'held' };

// Returns the plaintext codes exactly once, to the page that shows them:
// one Argon2id hash per code is stored, and a reload issues a different ten,
// replacing the set it just displayed.
//
// Taken under the subject's row lock, the one a factor removal holds, and
// only while a TOTP is held: a set that raced the removal of the last one is
// refused, and the action it was owed for is cleared.
export async function beginRecoveryCodes(
  tx: TenantScopedDatabase,
  input: IssueRecoveryCodes,
): Promise<BeginRecoveryCodesOutcome> {
  const held = await subjectRepository(tx).lock(input.subjectId);
  const standing = held ? await credentialRepository(tx).recoveryStanding(input.subjectId) : null;
  if (!standing?.hasTotp) {
    await requiredActionRepository(tx).complete(input.subjectId, 'generate-recovery-codes');
    return { kind: 'no_second_factor' };
  }

  if (input.keepHeld === true && standing.held > 0) return { kind: 'held' };

  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => hashPassword(normaliseRecoveryCode(code))));

  const repository = credentialRepository(tx);
  // Regenerating replaces the set rather than adding to it: the old ten
  // stop working the moment these are shown, which is the only honest
  // reading of a page that says "these are your codes".
  const replaced = await repository.deleteRecoveryCodes(input.subjectId);
  for (const hash of hashes) {
    await repository.insert({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash },
    });
  }
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'recovery_codes.issued',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    resourceType: 'subject',
    resourceId: input.subjectId,
  });
  return { kind: 'issued', offer: { codes, replaced: replaced > 0 } };
}

export type RecoveryCodesOutcome =
  { kind: 'acknowledged' } | { kind: 'rejected'; reason: 'none_issued' };

// The action is completed by the acknowledgement, not by the page that
// issued the codes: a subject who closed the tab before reading them still
// owes the action, and the next login issues a fresh set rather than
// leaving them with ten codes they never saw.
export async function completeRecoveryCodes(
  tx: TenantScopedDatabase,
  input: { subjectId: string },
): Promise<RecoveryCodesOutcome> {
  const held = await credentialRepository(tx).listFor(input.subjectId, 'recovery-code');
  if (held.length === 0) return { kind: 'rejected', reason: 'none_issued' };
  await requiredActionRepository(tx).complete(input.subjectId, 'generate-recovery-codes');
  return { kind: 'acknowledged' };
}

// A TOTP enrolment asks for a set, and so does spending the last code: each
// is a moment the subject has no way back. A passkey enrolment does not: a
// code is redeemed only at the TOTP code step, which a passkey skips. One with codes left is not
// asked, because re-issuing would silently retire the copy on their paper.
// Unspent rather than held is the whole point — spent rows are kept so a
// replay can be refused as spent (ADR 0021), so a subject who has used all
// ten still holds ten, and a guard counting rows leaves them owing nothing.
export async function oweRecoveryCodesIfNoneUnspent(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<void> {
  const usable = await credentialRepository(tx).countUnspentRecoveryCodes(subjectId);
  if (usable > 0) return;
  await requiredActionRepository(tx).add(tenantId, subjectId, 'generate-recovery-codes');
}

// The sign-in that completes is the one place a subject who holds a TOTP
// and no unspent code is certain to be in front of the server: codes
// revoked while a factor remains, or never issued to a subject enrolled
// before they existed, would otherwise leave them with no way back and no
// prompt. One aggregate, and the action is only added, so a set saved
// clears it and nothing here asks again.
export async function oweRecoveryCodesIfFactorWithoutCodes(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<void> {
  const standing = await credentialRepository(tx).recoveryStanding(subjectId);
  if (!standing.hasTotp || standing.unspent > 0) return;
  await requiredActionRepository(tx).add(tenantId, subjectId, 'generate-recovery-codes');
}

// What a subject still owes, for the gate that reads it. A set is owed only
// to somebody who holds a TOTP: the action can be left behind by a revoke
// followed by the removal of the last TOTP, or asked for by an administrator
// of a subject with none, and a sign-in meeting it would be refused for a
// page that cannot be shown. It is cleared here instead, so the login goes on.
export async function pendingActionsFor(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<RequiredAction[]> {
  const owed = await requiredActionRepository(tx).pendingFor(subjectId);
  if (!owed.includes('generate-recovery-codes')) return owed;
  if ((await credentialRepository(tx).recoveryStanding(subjectId)).hasTotp) return owed;
  await requiredActionRepository(tx).complete(subjectId, 'generate-recovery-codes');
  return owed.filter((action) => action !== 'generate-recovery-codes');
}
