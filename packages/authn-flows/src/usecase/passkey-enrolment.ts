import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import {
  parseRegistrationResponse,
  passkeyRegistrationOptions,
  verifyPasskeyRegistration,
} from '#/service/webauthn';
import { type PasskeyEnrolmentOffer } from '#/view/passkey-enrolment-html';

export interface BeginPasskeyEnrolment {
  realmName: string;
  publicBaseUrl: string;
  authSessionId: string;
  subjectId: string;
}

// The challenge is stored against the attempt, never rendered into a field
// the submission gives back: a challenge the response carries is one the
// response chose. Nothing else is written, so an abandoned enrolment leaves
// no credential behind — only a challenge that the next offer overwrites.
export async function beginPasskeyEnrolment(
  tx: RealmScopedDatabase,
  input: BeginPasskeyEnrolment,
): Promise<PasskeyEnrolmentOffer> {
  const user = await userRepository(tx).bySubjectId(input.subjectId);
  const existing = await credentialRepository(tx).listFor(input.subjectId, 'webauthn');
  const offer = await passkeyRegistrationOptions({
    publicBaseUrl: input.publicBaseUrl,
    realmName: input.realmName,
    username: user?.username ?? input.subjectId,
    userHandle: input.subjectId,
    existingCredentialIds: existing.flatMap((credential) =>
      credential.lookupKey === null ? [] : [credential.lookupKey],
    ),
  });
  await authenticationSessionRepository(tx).setWebauthnChallenge(
    input.authSessionId,
    offer.challenge,
  );
  return { options: offer.options };
}

export interface CompletePasskeyEnrolment {
  realmId: string;
  subjectId: string;
  authSessionId: string;
  publicBaseUrl: string;
  // The JSON navigator.credentials.create() produced, as it arrived.
  response: unknown;
  label?: string;
}

export type PasskeyEnrolmentOutcome =
  | { kind: 'enrolled'; credentialId: string }
  // No challenge was outstanding for this attempt: either none was ever
  // offered, or a previous response already spent the one that was. A
  // replay lands here, before any signature is looked at.
  | { kind: 'rejected'; reason: 'no_challenge' | 'invalid_response' };

const DEFAULT_LABEL = 'Passkey';

export async function completePasskeyEnrolment(
  tx: RealmScopedDatabase,
  input: CompletePasskeyEnrolment,
): Promise<PasskeyEnrolmentOutcome> {
  const challenge = await authenticationSessionRepository(tx).claimWebauthnChallenge(
    input.authSessionId,
  );
  if (challenge === null) return { kind: 'rejected', reason: 'no_challenge' };

  const response = parseRegistrationResponse(input.response);
  if (response === null) return { kind: 'rejected', reason: 'invalid_response' };

  const verified = await verifyPasskeyRegistration({
    publicBaseUrl: input.publicBaseUrl,
    expectedChallenge: challenge,
    response,
  });
  if (verified.kind === 'rejected') return { kind: 'rejected', reason: 'invalid_response' };

  // Nothing is stored until the library has verified the attestation: a
  // credential written ahead of that is one the subject may not hold, and
  // once a realm requires a passkey it is what stands between them and
  // their account. The counter is the authenticator's own use count at
  // registration, kept as the baseline an assertion must exceed.
  const label = input.label === undefined || input.label.length === 0 ? DEFAULT_LABEL : input.label;
  await credentialRepository(tx).insert({
    realmId: input.realmId,
    subjectId: input.subjectId,
    type: 'webauthn',
    lookupKey: verified.credentialId,
    label,
    secret: {
      kind: 'webauthn',
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
    },
  });
  await requiredActionRepository(tx).complete(input.subjectId, 'configure-passkey');
  return { kind: 'enrolled', credentialId: verified.credentialId };
}
