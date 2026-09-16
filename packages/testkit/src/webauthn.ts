import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

// A software authenticator, standing in for the browser and hardware a real
// WebAuthn ceremony needs. It produces the one attestation format that
// carries no statement to check ("none", WebAuthn §8.7), so a verifier
// still checks everything except a certificate chain: the client data's
// type, challenge and origin, the RP ID hash, the user-presence and
// user-verification flags, and the COSE public key it extracts.
export interface SoftwareRegistration {
  challenge: string;
  rpId: string;
  origin: string;
  // Clear it to imitate an authenticator that would have honoured
  // userVerification: 'preferred' by skipping its PIN. Set by default.
  userVerified?: boolean;
  // The authenticator's use count at registration. Whatever a caller puts
  // here is what a verifier reports back as the credential's counter.
  signCount?: number;
  // Reuse a previous ceremony's credential id, to imitate an authenticator
  // registering a credential the relying party already holds.
  credentialId?: Buffer;
}

// What the same authenticator signs when it answers an assertion. No
// attestation and no public key this time — the relying party already holds
// one, and WebAuthn §6.1 gives an assertion's authenticator data none.
export interface SoftwareAssertion {
  challenge: string;
  rpId: string;
  origin: string;
  // The count this authenticator claims for this use. A value at or below
  // the stored one is how a cloned authenticator gives itself away, so it
  // is always the caller's to choose.
  signCount: number;
  userVerified?: boolean;
  // What a discoverable credential returns alongside the signature: the
  // relying party's own identifier for whoever this credential belongs to.
  // Omitted unless a caller wants it, since an authenticator may return
  // none.
  userHandle?: string;
}

function cosePublicKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  // COSE_Key for an ES256 key: kty EC2, alg ES256, crv P-256, then the
  // two coordinates (RFC 8152 §13.1.1).
  const encoded = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(String(jwk.x), 'base64url')],
      [-3, Buffer.from(String(jwk.y), 'base64url')],
    ]),
  );
  return Buffer.from(encoded);
}

function authenticatorDataPrefix(rpId: string, flags: number, signCount: number): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  return Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([flags]), counter]);
}

function registrationAuthenticatorData(
  input: SoftwareRegistration,
  credentialId: Buffer,
  publicKey: KeyObject,
): Buffer {
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(credentialId.length);
  // User present and attested credential data included, always; user
  // verified only when this authenticator verified somebody.
  const flags = 0x01 | 0x40 | ((input.userVerified ?? true) ? 0x04 : 0x00);
  return Buffer.concat([
    authenticatorDataPrefix(input.rpId, flags, input.signCount ?? 0),
    // aaguid: all zeroes, which is what a platform authenticator reports
    // when it declines to identify its model.
    Buffer.alloc(16),
    credentialIdLength,
    credentialId,
    cosePublicKey(publicKey),
  ]);
}

// One key pair, one credential id, and both ceremonies it can take part in:
// a registration, then any number of assertions whose signatures actually
// check against the public key that registration stored. Enrolment and
// login therefore drive the same authenticator rather than two fixtures
// that could disagree about how an ES256 signature is formed.
export interface SoftwareAuthenticator {
  credentialId: Buffer;
  registration(input: Omit<SoftwareRegistration, 'credentialId'>): unknown;
  assertion(input: SoftwareAssertion): unknown;
}

export function softwareAuthenticator(seed: { credentialId?: Buffer } = {}): SoftwareAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = seed.credentialId ?? randomBytes(32);

  function clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  return {
    credentialId,

    registration(input) {
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Map<never, never> | Uint8Array>([
          ['fmt', 'none'],
          ['attStmt', new Map<never, never>()],
          [
            'authData',
            new Uint8Array(
              registrationAuthenticatorData({ ...input, credentialId }, credentialId, publicKey),
            ),
          ],
        ]),
      );
      return {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        response: {
          clientDataJSON: clientData('webauthn.create', input.challenge, input.origin).toString(
            'base64url',
          ),
          attestationObject: Buffer.from(attestationObject).toString('base64url'),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        type: 'public-key',
      };
    },

    assertion(input) {
      const flags = 0x01 | ((input.userVerified ?? true) ? 0x04 : 0x00);
      const authenticatorData = authenticatorDataPrefix(input.rpId, flags, input.signCount);
      const clientDataJSON = clientData('webauthn.get', input.challenge, input.origin);
      // WebAuthn §6.3.3: the signature is over the authenticator data
      // followed by the SHA-256 hash of the client data, and ES256 wants it
      // DER-encoded — which is what node:crypto's `sign` produces for an EC
      // key.
      const signature = sign(
        'sha256',
        Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]),
        privateKey,
      );
      return {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
          ...(input.userHandle === undefined
            ? {}
            : { userHandle: Buffer.from(input.userHandle).toString('base64url') }),
        },
        clientExtensionResults: {},
        type: 'public-key',
      };
    },
  };
}

// Shaped as RegistrationResponseJSON, returned as `unknown` so a caller
// passes it through the same narrowing a real browser's POST goes through
// rather than being handed a pre-trusted object. The key pair is thrown
// away with the call: a caller that needs to assert against what it
// registered reaches for softwareAuthenticator instead.
export function softwareRegistrationResponse(input: SoftwareRegistration): unknown {
  const { credentialId, ...ceremony } = input;
  return softwareAuthenticator(credentialId === undefined ? {} : { credentialId }).registration(
    ceremony,
  );
}
