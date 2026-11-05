import { type CredentialSecret } from '@odudu/domain-identity';
import { PASSKEY } from '#/service/authenticators/names';
import {
  parseAuthenticationResponse,
  verifyPasskeyAssertion,
  type RelyingParty,
} from '#/service/webauthn';

export type WebauthnSecret = Extract<CredentialSecret, { kind: 'webauthn' }>;

export interface PasskeyInput {
  // The JSON navigator.credentials.get() produced, as it arrived.
  assertion?: unknown;
}

// What the caller (usecase/executor) resolved before this runs, so this stays
// a leaf with no `tx` or repository. `credential` is null when the asserted
// id names no credential in this tenant; its `id` is the row's own, which the
// counter is written against, and `rpId` is the relying party it was
// registered under (the base host's where none was recorded). `relyingParty`
// is the tenant's canonical one, null where none can be derived.
export interface PasskeyVerification {
  credential: { id: string; subjectId: string; secret: WebauthnSecret; rpId: string | null } | null;
  expectedChallenge: string | null;
  relyingParty: RelyingParty | null;
}

// A success says more than AuthenticatorResult can, for the same reason
// TotpStepOutcome does: the counter the authenticator reported is half of
// clone detection, and storing it is the other half.
export type PasskeyStepOutcome =
  | { kind: 'success'; subjectId: string; credentialId: string; counter: number }
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };

// WebAuthn §6.1.1: a counter at or below the stored one means two
// authenticators are answering for one credential, which is what a clone
// looks like. The exception is an authenticator that never counts at all —
// §6.1.1 permits it, and it reports zero forever; refusing that refuses a
// conformant device rather than catching a clone.
export function counterAdvanced(stored: number, asserted: number): boolean {
  if (asserted === 0 && stored === 0) return true;
  return asserted > stored;
}

// Whether this submission is answering the passkey step at all. An empty
// field is not an answer: a browser with JavaScript off submits the passkey
// form with nothing in it, and reading that as an attempt would take the
// step away from the password and refuse a login nobody could complete.
export function assertionOffered(input: PasskeyInput): boolean {
  if (input.assertion === undefined || input.assertion === null) return false;
  return !(typeof input.assertion === 'string' && input.assertion.length === 0);
}

export async function passkeyStep(
  input: PasskeyInput,
  verification: PasskeyVerification,
): Promise<PasskeyStepOutcome> {
  if (!assertionOffered(input)) {
    return { kind: 'challenge', form: PASSKEY };
  }

  const response = parseAuthenticationResponse(input.assertion);
  const { credential, expectedChallenge, relyingParty } = verification;
  if (
    response === null ||
    credential === null ||
    expectedChallenge === null ||
    relyingParty === null
  ) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }
  // A passkey registered at another address stays on file but cannot answer
  // here: refused by name rather than left to the signature check.
  if (credential.rpId !== relyingParty.id) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }

  const verified = await verifyPasskeyAssertion({
    relyingParty,
    expectedChallenge,
    response,
    credential: {
      // The WebAuthn credential id, not the row's: the caller resolved this
      // row by that value, so the response's own id is it.
      id: response.id,
      publicKey: credential.secret.publicKey,
      counter: credential.secret.counter,
      transports: credential.secret.transports,
    },
  });
  if (verified.kind === 'rejected') return { kind: 'failure', reason: 'invalid_credentials' };

  if (!counterAdvanced(credential.secret.counter, verified.counter)) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }

  return {
    kind: 'success',
    subjectId: credential.subjectId,
    credentialId: credential.id,
    counter: verified.counter,
  };
}
