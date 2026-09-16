import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, hashPassword } from '@odudu/domain-identity';
import { requiredActionRepository } from '#/repository/required-actions';
import { generateRecoveryCodes, normaliseRecoveryCode } from '#/service/authenticators/recovery';
import { type RecoveryCodesOffer } from '#/view/recovery-codes-html';

export interface IssueRecoveryCodes {
  realmId: string;
  subjectId: string;
}

// Returns the plaintext codes exactly once, to the page that shows them.
// Nothing else ever holds them: one Argon2id hash per code is written, the
// array below is the only copy of the plaintext that exists, and the page
// that renders it is not re-renderable — a reload re-enters this function
// and issues a different ten, replacing the set it just displayed.
export async function beginRecoveryCodes(
  tx: RealmScopedDatabase,
  input: IssueRecoveryCodes,
): Promise<RecoveryCodesOffer> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => hashPassword(normaliseRecoveryCode(code))));

  const repository = credentialRepository(tx);
  // Regenerating replaces the set rather than adding to it: the old ten
  // stop working the moment these are shown, which is the only honest
  // reading of a page that says "these are your codes".
  const replaced = await repository.deleteFor(input.subjectId, 'recovery-code');
  for (const hash of hashes) {
    await repository.insert({
      realmId: input.realmId,
      subjectId: input.subjectId,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash },
    });
  }
  return { codes, replaced: replaced > 0 };
}

export type RecoveryCodesOutcome =
  { kind: 'acknowledged' } | { kind: 'rejected'; reason: 'none_issued' };

// The action is completed by the acknowledgement, not by the page that
// issued the codes: a subject who closed the tab before reading them still
// owes the action, and the next login issues a fresh set rather than
// leaving them with ten codes they never saw.
export async function completeRecoveryCodes(
  tx: RealmScopedDatabase,
  input: { subjectId: string },
): Promise<RecoveryCodesOutcome> {
  const held = await credentialRepository(tx).listFor(input.subjectId, 'recovery-code');
  if (held.length === 0) return { kind: 'rejected', reason: 'none_issued' };
  await requiredActionRepository(tx).complete(input.subjectId, 'generate-recovery-codes');
  return { kind: 'acknowledged' };
}

// Enrolling a second factor is what creates the lockout recovery codes
// exist to prevent — lose the phone or the authenticator and the password
// alone no longer signs anybody in — so both enrolments ask for a set.
// A subject who already holds codes is not asked again: a new second factor
// does not invalidate a list they have already saved, and re-issuing would
// silently retire the copy on their paper.
export async function oweRecoveryCodesIfNoneHeld(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
): Promise<void> {
  const held = await credentialRepository(tx).listFor(subjectId, 'recovery-code');
  if (held.length > 0) return;
  await requiredActionRepository(tx).add(realmId, subjectId, 'generate-recovery-codes');
}
