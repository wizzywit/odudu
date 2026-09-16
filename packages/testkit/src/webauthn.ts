import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
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

function cosePublicKey(): Buffer {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
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

function authenticatorData(input: SoftwareRegistration, credentialId: Buffer): Buffer {
  const signCount = Buffer.alloc(4);
  signCount.writeUInt32BE(input.signCount ?? 0);
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(credentialId.length);
  // User present and attested credential data included, always; user
  // verified only when this authenticator verified somebody.
  const flags = 0x01 | 0x40 | ((input.userVerified ?? true) ? 0x04 : 0x00);
  return Buffer.concat([
    createHash('sha256').update(input.rpId).digest(),
    Buffer.from([flags]),
    signCount,
    // aaguid: all zeroes, which is what a platform authenticator reports
    // when it declines to identify its model.
    Buffer.alloc(16),
    credentialIdLength,
    credentialId,
    cosePublicKey(),
  ]);
}

// Shaped as RegistrationResponseJSON, returned as `unknown` so a caller
// passes it through the same narrowing a real browser's POST goes through
// rather than being handed a pre-trusted object.
export function softwareRegistrationResponse(input: SoftwareRegistration): unknown {
  const credentialId = input.credentialId ?? randomBytes(32);
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Map<never, never> | Uint8Array>([
      ['fmt', 'none'],
      ['attStmt', new Map<never, never>()],
      ['authData', new Uint8Array(authenticatorData(input, credentialId))],
    ]),
  );
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false,
    }),
  );

  return {
    id: credentialId.toString('base64url'),
    rawId: credentialId.toString('base64url'),
    response: {
      clientDataJSON: clientDataJSON.toString('base64url'),
      attestationObject: Buffer.from(attestationObject).toString('base64url'),
      transports: ['internal'],
    },
    clientExtensionResults: {},
    type: 'public-key',
  };
}
