import { generateSigningKey, signJwt, toPublicJwk, type SigningKeyRecord } from '@odudu/crypto';
import { newId } from '@odudu/kernel';

// Shared by every suite that needs a private_key_jwt client: the assertion
// this repository actually verifies against RFC 7523 §3, and the JWKS
// document a jwks_uri or inline `jwks` column publishes it under.
// packages/protocol-oidc/tests/private-key-jwt.int.test.ts is the fullest
// exerciser of the authentication path itself.

export async function buildClientSigningKey(
  kek: Buffer,
  tenantId: string = newId(),
): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', kek);
  return {
    id: newId(),
    tenantId,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

export function jwksDocumentFor(key: SigningKeyRecord): { keys: Record<string, unknown>[] } {
  return { keys: [toPublicJwk(key.publicJwk, key.kid, key.alg)] };
}

export interface SignClientAssertionInput {
  key: SigningKeyRecord;
  clientId: string;
  audience: string;
  kek: Buffer;
  now?: Date;
  jti?: string;
  aud?: string;
  exp?: number;
  iss?: string;
  sub?: string;
}

export async function signClientAssertion(input: SignClientAssertionInput): Promise<string> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return signJwt(
    {
      iss: input.iss ?? input.clientId,
      sub: input.sub ?? input.clientId,
      aud: input.aud ?? input.audience,
      exp: input.exp ?? nowSeconds + 60,
      jti: input.jti ?? newId(),
    },
    { key: input.key, kek: input.kek },
  );
}
