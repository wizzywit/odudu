import type { SigningKey } from '#/entities/signing-key/types/signingKey';

// No signed token outlives its client's access token lifetime, which
// `client_oidc_config_access_token_ttl_ceiling`
// (packages/db/drizzle/0013_access_token_ttl_ceiling.sql) holds to an hour;
// refresh tokens are opaque and signed by no key.
export const LONGEST_TOKEN_LIFETIME_SECONDS = 3600;

const MARGIN_SECONDS = 300;

export function promotableAt(
  key: SigningKey,
  longestTokenLifetimeSeconds = LONGEST_TOKEN_LIFETIME_SECONDS,
): Date {
  const published = new Date(key.created_at).getTime();
  return new Date(published + (longestTokenLifetimeSeconds + MARGIN_SECONDS) * 1000);
}

// A key carries only `created_at`, and a promotion demotes the key it
// replaces to `rotating` too, so a rotating key older than the active one
// is taken to be a demoted one: a key to retire, not to promote. A rotating
// key of another algorithm already signs for the clients that ask for it,
// and promoting it would change the algorithm of every token.
export function readyToPromote(
  keys: readonly SigningKey[],
  now: Date,
  longestTokenLifetimeSeconds = LONGEST_TOKEN_LIFETIME_SECONDS,
): readonly SigningKey[] {
  const active = keys.find((key) => key.status === 'active');
  const activeSince = active === undefined ? null : new Date(active.created_at).getTime();
  return keys.filter(
    (key) =>
      key.status === 'rotating' &&
      (active === undefined || key.alg === active.alg) &&
      (activeSince === null || new Date(key.created_at).getTime() > activeSince) &&
      now.getTime() > promotableAt(key, longestTokenLifetimeSeconds).getTime(),
  );
}

export type Promotion =
  | { kind: 'ready' }
  | { kind: 'young'; at: Date }
  | { kind: 'algorithm'; active: string }
  | { kind: 'replaced' }
  | { kind: 'unknown' };

// Judged against the active key, so nothing is judged until it has been read.
export function promotionOf(
  key: SigningKey,
  keys: readonly SigningKey[],
  now: Date,
  activeKnown: boolean,
): Promotion {
  if (!activeKnown) return { kind: 'unknown' };
  const active = keys.find((other) => other.status === 'active');
  if (readyToPromote([...(active === undefined ? [] : [active]), key], now).length > 0) {
    return { kind: 'ready' };
  }
  const at = promotableAt(key);
  if (now.getTime() <= at.getTime()) return { kind: 'young', at };
  if (active !== undefined && active.alg !== key.alg) {
    return { kind: 'algorithm', active: active.alg };
  }
  return { kind: 'replaced' };
}
