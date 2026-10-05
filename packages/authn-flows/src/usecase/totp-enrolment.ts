import { generateTotpSecret, verifyTotp } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { systemClock, type Clock } from '@odudu/kernel';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { oweRecoveryCodesIfNoneUnspent } from '#/usecase/recovery-codes';
import { OTP } from '#/service/authenticators/names';
import { isTotpSecretShape, totpEnrolmentUri } from '#/service/authenticators/totp';
import { type TotpEnrolmentOffer } from '#/view/totp-enrolment-html';

// A fresh secret every time the page is rendered, and nothing is written
// until a code proves the app holds it. An abandoned enrolment therefore
// leaves nothing behind at all.
export async function beginTotpEnrolment(
  tx: TenantScopedDatabase,
  tenantName: string,
  subjectId: string,
): Promise<TotpEnrolmentOffer> {
  const user = await userRepository(tx).bySubjectId(subjectId);
  const secret = generateTotpSecret();
  return {
    secret,
    uri: totpEnrolmentUri({
      issuer: tenantName,
      account: user?.username ?? subjectId,
      secret,
    }),
  };
}

export type TotpEnrolmentOutcome =
  { kind: 'enrolled' } | { kind: 'rejected'; reason: 'invalid_code' | 'already_enrolled' };

export async function completeTotpEnrolment(
  tx: TenantScopedDatabase,
  // `authSessionId` names the login the code was typed into. The code just
  // proved possession of the new authenticator, so that login records its
  // otp factor and is not asked for a code again.
  input: {
    tenantId: string;
    subjectId: string;
    secret: string;
    code: string;
    authSessionId: string;
  },
  clock: Clock = systemClock,
): Promise<TotpEnrolmentOutcome> {
  const existing = await credentialRepository(tx).listFor(input.subjectId, 'totp');
  if (existing.length > 0) return { kind: 'rejected', reason: 'already_enrolled' };
  if (!isTotpSecretShape(input.secret)) return { kind: 'rejected', reason: 'invalid_code' };

  const now = clock.now();
  const verified = verifyTotp({
    secret: input.secret,
    code: input.code,
    now,
    lastStep: null,
  });
  if (!verified.ok) return { kind: 'rejected', reason: 'invalid_code' };

  // The confirming code is spent by the credential it creates: `lastStep`
  // stops the same code being replayed at a later login (RFC 6238 §5.2,
  // docs/protocols/rfc6238.md).
  await credentialRepository(tx).insert({
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    type: 'totp',
    secret: { kind: 'totp', secret: input.secret, digits: 6, lastStep: verified.step },
  });
  await authenticationSessionRepository(tx).recordSatisfied(input.authSessionId, OTP);
  await requiredActionRepository(tx).complete(input.subjectId, 'configure-totp');
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'otp.enrolled',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    resourceType: 'subject',
    resourceId: input.subjectId,
  });
  await oweRecoveryCodesIfNoneUnspent(tx, input.tenantId, input.subjectId);
  return { kind: 'enrolled' };
}
