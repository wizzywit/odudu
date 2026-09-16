import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { z } from 'zod';

// WebAuthn §5.1.3 binds a credential to the relying party's identifier, and
// a browser will not offer a credential whose RP ID is not a registrable
// suffix of the page's own domain. So the value has to come from what the
// operator says this deployment is published as — never from `Host` or
// `X-Forwarded-Host`, which the client controls: a credential registered
// against an attacker-chosen RP ID is a credential for the attacker's
// origin, and one registered against a merely wrong RP ID is unusable and
// silently so.
function publicOrigin(publicBaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(publicBaseUrl);
  } catch {
    throw new Error(`ODUDU_PUBLIC_BASE_URL is not an absolute URL: "${publicBaseUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`ODUDU_PUBLIC_BASE_URL must use http or https, got "${parsed.protocol}"`);
  }
  return parsed;
}

// An RP ID is a domain, and WebAuthn §5.1.3's same-origin check compares
// it as one: a browser can never match a credential's RP ID against an
// address literal, so a passkey registered against one is unusable from
// the moment it is created. `[…]` is how URL renders an IPv6 host, and a
// host of only digits and dots is an IPv4 one — no registrable domain
// looks like either.
function isAddressLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^[0-9.]+$/.test(hostname);
}

export function relyingPartyId(publicBaseUrl: string): string {
  const hostname = publicOrigin(publicBaseUrl).hostname;
  if (isAddressLiteral(hostname)) {
    throw new Error(
      `ODUDU_PUBLIC_BASE_URL must name a domain, not an address: "${hostname}" can never be a ` +
        'WebAuthn relying party id',
    );
  }
  return hostname;
}

// What clientDataJSON has to name, port included — unlike the RP ID, which
// is a domain and carries none.
export function relyingPartyOrigin(publicBaseUrl: string): string {
  const parsed = publicOrigin(publicBaseUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

export interface PasskeyRegistrationRequest {
  publicBaseUrl: string;
  realmName: string;
  username: string;
  // The WebAuthn user handle, which a discoverable credential returns
  // instead of a username. The subject id, so a later assertion has a
  // second way to resolve whose credential answered.
  userHandle: string;
  existingCredentialIds: readonly string[];
}

export interface PasskeyRegistrationOffer {
  options: PublicKeyCredentialCreationOptionsJSON;
  // The same value as options.challenge, named separately because it is
  // what the server stores and the options are what the browser gets.
  challenge: string;
}

export async function passkeyRegistrationOptions(
  request: PasskeyRegistrationRequest,
): Promise<PasskeyRegistrationOffer> {
  const options = await generateRegistrationOptions({
    rpName: request.realmName,
    rpID: relyingPartyId(request.publicBaseUrl),
    userName: request.username,
    userID: new TextEncoder().encode(request.userHandle),
    // A subject who already has a passkey enrols a second one on a
    // different authenticator, not a duplicate on the same one.
    excludeCredentials: request.existingCredentialIds.map((id) => ({ id })),
    // Both required rather than the library's "preferred" defaults, and
    // both for a property of what this credential is for. A passkey stands
    // alone as a factor that counts as two, which is only true if the
    // authenticator actually verified the person holding it — unverified,
    // it is one factor wearing two factors' authority. And a credential
    // that is not discoverable cannot answer an assertion that names no
    // username, which is the only way a passkey is offered as a first
    // factor. Neither can be retrofitted: both are fixed at creation.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options, challenge: options.challenge };
}

// What the browser posts back is JSON from outside, so it arrives as
// `unknown` and is narrowed here rather than asserted. Only the fields the
// verification reads are kept: the extension outputs and the attachment
// hint are the browser's own commentary on the ceremony, and nothing
// downstream of this parse consults them.
const registrationResponseShape = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
    transports: z.array(z.string()).optional(),
  }),
});

export function parseRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  const parsed = registrationResponseShape.safeParse(value);
  if (!parsed.success) return null;
  const { id, rawId, response } = parsed.data;
  return {
    id,
    rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      ...(response.transports === undefined ? {} : { transports: response.transports }),
    },
  };
}

export interface PasskeyRegistrationVerification {
  publicBaseUrl: string;
  expectedChallenge: string;
  response: RegistrationResponseJSON;
}

// What a verified registration leaves for storage: the credential id the
// later assertion resolves a subject by, the public key that checks its
// signature, and the authenticator's own signature counter, which is the
// baseline a clone shows up as a step backwards from.
export type PasskeyRegistrationOutcome =
  | {
      kind: 'verified';
      credentialId: string;
      publicKey: string;
      counter: number;
      transports: string[];
    }
  | { kind: 'rejected' };

export async function verifyPasskeyRegistration(
  input: PasskeyRegistrationVerification,
): Promise<PasskeyRegistrationOutcome> {
  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: relyingPartyOrigin(input.publicBaseUrl),
      expectedRPID: relyingPartyId(input.publicBaseUrl),
      // Stated rather than inherited, and it is the same requirement the
      // options ask the authenticator for: a response whose user-verified
      // flag is clear is refused here, so the two sides cannot drift into
      // asking for verification and then accepting its absence.
      requireUserVerification: true,
    });
  } catch {
    // Every refusal the library makes by throwing — a challenge that does
    // not match, an origin that does not, an undecodable attestation — is
    // an enrolment this subject may retry, not a server fault.
    return { kind: 'rejected' };
  }
  if (!verification.verified) return { kind: 'rejected' };

  const { credential } = verification.registrationInfo;
  return {
    kind: 'verified',
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
  };
}
