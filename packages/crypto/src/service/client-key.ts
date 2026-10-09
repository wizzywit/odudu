import { OduduError } from '@odudu/kernel';
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type CryptoKey,
  type KeyObject,
} from 'jose';
import { randomUUID } from 'node:crypto';
import { PRIVATE_JWK_MEMBERS } from '#/service/jwks';

const ALG = 'ES256';
// An assertion lives a minute: the server remembers its jti until it
// expires, and a replay inside that minute is refused.
const ASSERTION_LIFETIME_SECONDS = 60;

export interface ClientKey {
  readonly kid: string;
  readonly privateKey: CryptoKey | KeyObject;
  readonly publicJwk: Record<string, unknown>;
}

function parseJwk(serialized: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new OduduError('client_key_invalid', 'the key is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OduduError('client_key_invalid', 'the key is not a JSON object');
  }
  const jwk = parsed as Record<string, unknown>;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new OduduError('client_key_invalid', 'the key is not an EC P-256 key');
  }
  return jwk;
}

async function publicJwkOf(jwk: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { x, y } = jwk;
  if (typeof x !== 'string' || typeof y !== 'string') {
    throw new OduduError('client_key_invalid', 'the key has no public coordinates');
  }
  const base = { kty: 'EC', crv: 'P-256', x, y };
  const kid = await calculateJwkThumbprint(base);
  return { ...base, kid, alg: ALG, use: 'sig' };
}

/** A new signing key as the one-line private JWK the configuration holds. */
export async function generateClientKey(): Promise<string> {
  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = (await exportJWK(privateKey)) as Record<string, unknown>;
  const { kid } = await publicJwkOf(jwk);
  return JSON.stringify({ ...jwk, kid, alg: ALG, use: 'sig' });
}

/**
 * The kid is the key's RFC 7638 thumbprint, never what the value claims, so
 * the registered key set and the assertion header cannot disagree about it.
 */
export async function loadClientKey(serialized: string): Promise<ClientKey> {
  const jwk = parseJwk(serialized);
  if (typeof jwk.d !== 'string') {
    throw new OduduError('client_key_invalid', 'the key has no private part to sign with');
  }
  const publicJwk = await publicJwkOf(jwk);
  let privateKey: CryptoKey | KeyObject;
  try {
    privateKey = (await importJWK({ ...jwk, alg: ALG }, ALG)) as CryptoKey | KeyObject;
  } catch {
    throw new OduduError('client_key_invalid', 'the key is not a valid EC P-256 private key');
  }
  return { kid: publicJwk.kid as string, privateKey, publicJwk };
}

/** A key that no longer signs but still verifies; a private key is reduced to its public half. */
export async function loadRetiredClientKey(serialized: string): Promise<Record<string, unknown>> {
  return publicJwkOf(parseJwk(serialized));
}

/** The JWK Set a tenant's built-in admin client registers: the signing key, then each retired one. */
export function registeredClientJwks(
  current: ClientKey,
  retired: readonly Record<string, unknown>[],
): { keys: Record<string, unknown>[] } {
  const keys = [current.publicJwk];
  for (const key of retired) if (!keys.some((known) => known.kid === key.kid)) keys.push(key);
  for (const key of keys) {
    for (const member of PRIVATE_JWK_MEMBERS) {
      if (member in key) throw new Error(`a registered client key carries ${member}`);
    }
  }
  return { keys };
}

/** RFC 7523 §3's assertion for `private_key_jwt`: the client is both issuer and subject. */
export function signClientAssertion(
  key: ClientKey,
  input: { clientId: string; audience: string; now: Date },
): Promise<string> {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: key.kid })
    .setIssuer(input.clientId)
    .setSubject(input.clientId)
    .setAudience(input.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ASSERTION_LIFETIME_SECONDS)
    .setJti(randomUUID())
    .sign(key.privateKey);
}
