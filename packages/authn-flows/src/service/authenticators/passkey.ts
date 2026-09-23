import { type CredentialSecret } from '@odudu/domain-identity';
import { PASSKEY } from '#/service/authenticators/names';
import { parseAuthenticationResponse, verifyPasskeyAssertion } from '#/service/webauthn';

export type WebauthnSecret = Extract<CredentialSecret, { kind: 'webauthn' }>;

export interface PasskeyInput {
  // The JSON navigator.credentials.get() produced, as it arrived.
  assertion?: unknown;
}

// What the caller (usecase/executor) already resolved, before this function
// runs — this stays a leaf: no `tx`, no repository, no cross-package call.
// verifyAuthenticationResponse needs the stored credential as an input, so
// resolution cannot wait for verification: `credential` is null when the id
// the assertion carries names no credential in this tenant. `id` is the
// credential row's own id, which is what the counter is written against.
export interface PasskeyVerification {
  credential: { id: string; subjectId: string; secret: WebauthnSecret } | null;
  expectedChallenge: string | null;
  publicBaseUrl: string | null;
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
  const { credential, expectedChallenge, publicBaseUrl } = verification;
  if (
    response === null ||
    credential === null ||
    expectedChallenge === null ||
    publicBaseUrl === null
  ) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }

  const verified = await verifyPasskeyAssertion({
    publicBaseUrl,
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
