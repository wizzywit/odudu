import { importJWK, SignJWT } from 'jose';
import type { PrivateKeyJwk } from '#/types';
import { OduduError } from '#/services/odudu-error';
import { assertionAlgorithm, assertionClaims } from '#/services/client-credentials-request';

export interface AssertionKey {
  key: PrivateKeyJwk;
  kid?: string;
  alg?: string;
}

// Signs the JWT a client presents in place of a secret (RFC 7523, OIDC Core
// section 9). It runs on WebCrypto, so it works in a browser, Node and an
// edge runtime.
export async function signAssertion(
  signing: AssertionKey,
  clientId: string,
  tokenEndpoint: string,
  nowSeconds: number,
): Promise<string> {
  const alg = assertionAlgorithm(signing.key, signing.alg);
  try {
    const key = await importJWK({ ...signing.key }, alg);
    return await new SignJWT(
      assertionClaims(clientId, tokenEndpoint, crypto.randomUUID(), nowSeconds),
    )
      .setProtectedHeader({ alg, ...(signing.kid === undefined ? {} : { kid: signing.kid }) })
      .sign(key);
  } catch (cause) {
    throw new OduduError('invalid_options', 'the private key cannot sign with that algorithm', {
      cause,
    });
  }
}
