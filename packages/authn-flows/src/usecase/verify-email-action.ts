import { type TenantScopedDatabase } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { requiredActionRepository } from '#/repository/required-actions';

// What the verify-email page shows: the address held and whether it is proved.
export interface VerifyEmailOffer {
  email: string | null;
  verified: boolean;
}

export async function verifyEmailOffer(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<VerifyEmailOffer> {
  const user = await userRepository(tx).bySubjectId(subjectId);
  return { email: user?.email ?? null, verified: user?.emailVerified ?? false };
}

export type VerifyEmailOutcome = { kind: 'verified' } | { kind: 'not_verified' };

// The action is done when the address is proved, however it came to be: the
// subject is read again here, so a link used in another tab counts.
export async function completeVerifyEmail(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<VerifyEmailOutcome> {
  const offer = await verifyEmailOffer(tx, subjectId);
  if (!offer.verified) return { kind: 'not_verified' };
  await requiredActionRepository(tx).complete(subjectId, 'verify-email');
  return { kind: 'verified' };
}
