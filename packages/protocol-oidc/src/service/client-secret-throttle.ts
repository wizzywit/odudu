// RFC 6749 §2.3.1's brute-force MUST names endpoints doing *password*
// authentication. client_secret_basic (the Basic header) and
// client_secret_post (the body parameter) are that: both present a shared
// secret. private_key_jwt proves possession of a key instead — this
// predicate is what keeps a private_key_jwt client off a budget meant for
// guessed secrets: `authenticatePrivateKeyJwt` (usecase/token-issuance.ts)
// never calls `authenticateClient`, so it never reaches this check at all.
export function isPasswordAuthMethod(
  method: string,
): method is 'client_secret_basic' | 'client_secret_post' {
  return method === 'client_secret_basic' || method === 'client_secret_post';
}

/** ADR 0023's client-authentication limit is per client, not per realm or global. */
export function clientSecretLimiterKey(realmId: string, oauthClientId: string): string {
  return `${realmId}:${oauthClientId}`;
}

/**
 * What `authenticateClient` (packages/protocol-oidc/src/usecase/token-issuance.ts)
 * consults after a client_secret_basic/client_secret_post attempt fails.
 * The concrete instance is `apps/server/src/throttle.ts`'s `slidingWindow`,
 * injected rather than imported so this package never depends on the app —
 * the shape is duplicated, not the implementation.
 */
export interface ClientSecretLimiter {
  check: (key: string) => { allowed: boolean; retryAfterSeconds: number };
}

// Never refuses. `oidcRoutes`'s `clientSecretLimiter` is required, not
// defaulted (index.ts), so a caller that genuinely has no opinion on this
// budget — every integration test exercising something else — says so
// explicitly by passing this, rather than the package silently guessing
// on a caller's behalf what only `apps/server/src/app.ts`'s real
// `slidingWindow` wiring should decide.
export const UNLIMITED_CLIENT_SECRET_LIMITER: ClientSecretLimiter = {
  check: () => ({ allowed: true, retryAfterSeconds: 0 }),
};
