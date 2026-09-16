import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { oweRecoveryCodesIfNoneHeld } from '#/usecase/recovery-codes';
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
  // no_challenge: none was outstanding for this attempt — either none was
  // ever offered, or a previous response already spent the one that was,
  // which is where a replay lands, before any signature is looked at.
  // already_enrolled: this realm already holds that credential id.
  | { kind: 'rejected'; reason: 'no_challenge' | 'invalid_response' | 'already_enrolled' };

const DEFAULT_LABEL = 'Passkey';

// Long enough to name an authenticator, short enough that the column is
// not a place to put arbitrary text. Truncated rather than refused: a
// label is what the list of a subject's passkeys reads like, and nothing
// decides anything by it.
const LABEL_MAX_LENGTH = 64;

function boundedLabel(label: string | undefined): string {
  if (label === undefined || label.length === 0) return DEFAULT_LABEL;
  return label.slice(0, LABEL_MAX_LENGTH);
}

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

  // user_credentials_lookup_key (migration 0034) is unique per realm and
  // remains the actual guarantee. This read only turns the case
  // excludeCredentials is expected to prevent into a refusal rather than a
  // constraint violation surfacing as a server fault; two subjects racing
  // to claim one credential id still fail at the index, which is the right
  // place for something that cannot legitimately happen.
  const claimed = await credentialRepository(tx).byLookupKey(verified.credentialId);
  if (claimed !== null) return { kind: 'rejected', reason: 'already_enrolled' };

  // Nothing is stored until the library has verified the attestation: a
  // credential written ahead of that is one the subject may not hold, and
  // once a realm requires a passkey it is what stands between them and
  // their account. The counter is the authenticator's own use count at
  // registration, kept as the baseline an assertion must exceed.
  await credentialRepository(tx).insert({
    realmId: input.realmId,
    subjectId: input.subjectId,
    type: 'webauthn',
    lookupKey: verified.credentialId,
    label: boundedLabel(input.label),
    secret: {
      kind: 'webauthn',
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
    },
  });
  await requiredActionRepository(tx).complete(input.subjectId, 'configure-passkey');
  await oweRecoveryCodesIfNoneHeld(tx, input.realmId, input.subjectId);
  return { kind: 'enrolled', credentialId: verified.credentialId };
}
