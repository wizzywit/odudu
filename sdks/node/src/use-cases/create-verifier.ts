import { createKeyStore } from '#/repository/keys';
import { checkHeader, claimedIssuer, readClaims, verifySigned } from '#/services/access-token';
import { VerificationError } from '#/services/verification-error';
import type { VerifiedToken, VerifierOptions } from '#/types';

const DEFAULT_TTL_MS = 300_000;

// Checks an access token for an API, rejecting with a `VerificationError`
// when the token is at fault and a `KeyFetchError` when the issuer's keys
// could not be read.
export function createVerifier(
  options: VerifierOptions,
): (token: string) => Promise<VerifiedToken> {
  if (options.issuers.length === 0) throw new TypeError('createVerifier needs at least one issuer');
  if (options.audience === '') throw new TypeError('createVerifier needs the API audience');
  const issuers = [...options.issuers];
  const now = options.clock ?? Date.now;
  const store = createKeyStore({
    ttlMs: options.jwksTtlMs ?? DEFAULT_TTL_MS,
    now,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
  });

  return async (token) => {
    const issuer = claimedIssuer(token, issuers);
    const header = checkHeader(token);
    const jwk = await store.keyFor(issuer, header.kid);
    if (jwk === undefined) throw new VerificationError('unknown_key');
    const payload = await verifySigned(token, jwk, header, {
      issuer,
      audience: options.audience,
      nowMs: now(),
    });
    return readClaims(payload, issuers, options.requiredScope);
  };
}
