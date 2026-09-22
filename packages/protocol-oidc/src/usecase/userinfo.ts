import {
  encodeUnsecuredJwt,
  encryptCompact,
  selectEncryptionKey,
  signJwt,
  verifyJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { type ClaimMapperRegistry } from '@odudu/kernel';
import { presentedBearerToken } from '#/service/bearer-token';
import { type ClaimContext } from '#/service/claims';
import { narrowByScopeMappings } from '#/service/scope-mapping';
import { type ClientKeySet } from '#/repository/client-keys';
import { type RealmLookup } from '#/repository/realm-lookup';

export interface UserinfoDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  loadClaimContext(realmId: string, subjectId: string): Promise<ClaimContext>;
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  // The role set a granted scope reaches, and whether the token's client
  // bypasses that intersection — the same gate token issuance applies, so
  // a role withheld from a token cannot resurface here.
  resolveRoleReach(
    realmId: string,
    oauthClientId: string,
    scope: readonly string[],
  ): Promise<{ reachableRoleIds: ReadonlySet<string>; fullScopeAllowed: boolean }>;
  // The real request's CORS decision is checked against this one client's
  // own expanded origins, resolved from the access token's `client_id`
  // claim rather than any credential the preflight could have carried.
  resolveClientWebOrigins(realmId: string, oauthClientId: string): Promise<ReadonlySet<string>>;
  // `null` when the client registered no `userinfo_signed_response_alg` at
  // all, or has none by the time this runs (unknown or disabled client) —
  // both read as "answer in JSON," the response format's default.
  userinfoSignedResponseAlg(realmId: string, oauthClientId: string): Promise<string | null>;
  // The realm's active signing key — the same one `/token` signs an access
  // token or ID Token with, and the only one this server can sign with.
  activeSigningKey(realmId: string): Promise<SigningKeyRecord>;
  // `'none'` and `'unavailable'` are deliberately not the same value: a
  // client that never registered `userinfo_encrypted_response_alg` reads
  // `'none'` — answer plainly, same as `userinfoSignedResponseAlg`'s
  // `null` above. A client that registered it but is disabled (or
  // otherwise cannot be resolved to a live config) reads `'unavailable'`
  // — a registration this server cannot honour right now is not the same
  // as no registration at all, and collapsing them here is what let a
  // disabled client's encrypted claims answer in clear text.
  userinfoEncryptionTarget(
    realmId: string,
    oauthClientId: string,
  ): Promise<UserinfoEncryptionLookup>;
  // RFC 7523 §2.2's fetcher for a client's jwks_uri — the same one /token
  // dereferences a private_key_jwt client's key with. Consulted here for
  // the first time on the /userinfo response path; docs/superpowers/p3b-spike-jwe.md's
  // Question 2 measured what a dead jwks_uri costs on it.
  clientKeySet: ClientKeySet;
  kek: Uint8Array;
}

export interface UserinfoEncryptionTarget {
  alg: string;
  enc: string;
  jwks: unknown;
  jwksUri: string | null;
}

export type UserinfoEncryptionLookup =
  { kind: 'none' } | { kind: 'unavailable' } | { kind: 'target'; target: UserinfoEncryptionTarget };

export type UserinfoBody =
  { kind: 'json'; claims: Record<string, unknown> } | { kind: 'jwt'; token: string };

// RFC 8725 §3.11's explicit typing, applied where confusing this response
// with an ID Token hint would matter: `subjectOfIdTokenHint` demands
// `TYP_ABSENT` (see docs/protocols/oidc-core.md's reading note for why "no
// registered typ exists" is not the same claim as "emit none").
export const USERINFO_JWT_TYP = 'userinfo+jwt';

export type UserinfoOutcome =
  | { kind: 'not_found' }
  // No Authorization header at all: RFC 6750 §3.1 SHOULD omits an error
  // code here, distinct from a header that was present but rejected.
  | { kind: 'missing_credentials' }
  // The token arrived by more than one method, or twice by one. RFC 6750
  // §3.1 gives this `invalid_request`, and §3.1's HTTP 400.
  | { kind: 'invalid_request' }
  | { kind: 'invalid_token' }
  // clientId is set here and on `ok` because both are reached only once the
  // token verifies — it names the client CORS checks the response's origin
  // against; every earlier outcome never got that far.
  | { kind: 'insufficient_scope'; clientId: string | undefined }
  // A client registered `userinfo_signed_response_alg` for an algorithm
  // this realm's active key no longer carries — see `view/routes/userinfo.ts`
  // for how this is answered and logged.
  | {
      kind: 'signing_unavailable';
      clientId: string | undefined;
      registeredAlg: string;
      activeAlg: string;
    }
  // A client registered `userinfo_encrypted_response_alg` and this response
  // could not be encrypted for it — an unreachable jwks_uri, or a JWKS that
  // names no encryption key unambiguously (see `view/routes/userinfo.ts`
  // for how this is answered and logged). Answering in clear text here
  // would publish exactly what the client asked to have protected, so this
  // is a refusal, never a fallback to `ok`.
  | { kind: 'encryption_unavailable'; clientId: string | undefined; reason: string }
  | { kind: 'ok'; body: UserinfoBody; clientId: string | undefined };

function scopesOf(scopeClaim: unknown): string[] {
  return typeof scopeClaim === 'string'
    ? scopeClaim.split(' ').filter((token) => token.length > 0)
    : [];
}

// Validation order, matching RFC 9068 §4 and RFC 6750 §3.1: signature and
// `kid` → `typ: at+jwt`, which is what stops an ID Token signed by the same
// key being presented here → `iss` → `exp` → `aud` contains this issuer
// (all inside verifyJwt, whose `audience` option accepts an array `aud`
// containing the issuer rather than matching a bare string) → and only once
// the token is valid, the `openid` scope check: a 403, not the 401 that
// would let a caller distinguish a bad token from a valid one with the
// wrong scope.
export async function resolveUserinfo(
  deps: UserinfoDeps,
  realmName: string,
  issuer: string,
  authorizationHeader: string | undefined,
  // Whatever a body parser produced for a POST (OIDC Core §5.3); `undefined`
  // for a GET, which has no body to carry a token in.
  body: unknown,
): Promise<UserinfoOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'not_found' };

  const presented = presentedBearerToken(authorizationHeader, body);
  if (presented.kind === 'ambiguous') return { kind: 'invalid_request' };
  if (presented.kind === 'absent') return { kind: 'missing_credentials' };
  const { token } = presented;

  const keys = await deps.listPublishableKeys(realm.id);

  let payload;
  try {
    payload = await verifyJwt(token, { keys, issuer, audience: issuer, typ: 'at+jwt' });
  } catch {
    return { kind: 'invalid_token' };
  }

  const clientId = typeof payload.client_id === 'string' ? payload.client_id : undefined;

  const scope = scopesOf(payload.scope);
  if (!scope.includes('openid')) return { kind: 'insufficient_scope', clientId };

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { kind: 'invalid_token' };
  }

  const ctx = await deps.loadClaimContext(realm.id, payload.sub);
  // A token with no readable client_id reaches no role: the gate fails
  // closed rather than falling back to the subject's full role set.
  const { reachableRoleIds, fullScopeAllowed } =
    clientId === undefined
      ? { reachableRoleIds: new Set<string>(), fullScopeAllowed: false }
      : await deps.resolveRoleReach(realm.id, clientId, scope);
  const narrowedCtx: ClaimContext = {
    ...ctx,
    roles: narrowByScopeMappings(ctx.roles, reachableRoleIds, fullScopeAllowed),
  };
  const claims = await deps.claimMappers.assemble(scope, narrowedCtx);
  const signed = await signedBody(deps, realm.id, issuer, clientId, claims);
  if (signed.kind === 'mismatch') {
    return {
      kind: 'signing_unavailable',
      clientId,
      registeredAlg: signed.registeredAlg,
      activeAlg: signed.activeAlg,
    };
  }

  const encrypted = await encryptedBody(deps, realm.id, clientId, signed.body);
  if (encrypted.kind === 'unavailable') {
    return { kind: 'encryption_unavailable', clientId, reason: encrypted.reason };
  }
  return { kind: 'ok', body: encrypted.body, clientId };
}

type SignedBodyResult =
  | { kind: 'body'; body: UserinfoBody }
  | { kind: 'mismatch'; registeredAlg: string; activeAlg: string };

// OIDC Core §5.3.2; see "A signed UserInfo response" in
// docs/protocols/oidc-core.md before changing this.
async function signedBody(
  deps: UserinfoDeps,
  realmId: string,
  issuer: string,
  clientId: string | undefined,
  claims: Record<string, unknown>,
): Promise<SignedBodyResult> {
  if (clientId === undefined) return { kind: 'body', body: { kind: 'json', claims } };

  const alg = await deps.userinfoSignedResponseAlg(realmId, clientId);
  if (alg === null) return { kind: 'body', body: { kind: 'json', claims } };

  const signedClaims = { ...claims, iss: issuer, aud: clientId };
  if (alg === 'none') {
    return { kind: 'body', body: { kind: 'jwt', token: encodeUnsecuredJwt(signedClaims) } };
  }

  const key = await deps.activeSigningKey(realmId);
  if (key.alg !== alg) return { kind: 'mismatch', registeredAlg: alg, activeAlg: key.alg };
  const token = await signJwt(signedClaims, { key, kek: deps.kek, typ: USERINFO_JWT_TYP });
  return { kind: 'body', body: { kind: 'jwt', token } };
}

type EncryptedBodyResult =
  { kind: 'body'; body: UserinfoBody } | { kind: 'unavailable'; reason: string };

function asJwks(value: unknown): { keys: unknown[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const keys = (value as Record<string, unknown>).keys;
  return Array.isArray(keys) ? { keys } : null;
}

// OIDC Core §5.3.2; see "docs/superpowers/p3b-spike-jwe.md" before changing
// this. Never falls back to the unencrypted form on any branch below — see
// `encryption_unavailable` on `UserinfoOutcome` for why.
async function encryptedBody(
  deps: UserinfoDeps,
  realmId: string,
  clientId: string | undefined,
  body: UserinfoBody,
): Promise<EncryptedBodyResult> {
  if (clientId === undefined) return { kind: 'body', body };

  const lookup = await deps.userinfoEncryptionTarget(realmId, clientId);
  if (lookup.kind === 'none') return { kind: 'body', body };
  if (lookup.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'client is disabled or unresolvable' };
  }
  const target = lookup.target;

  let jwks: unknown;
  if (target.jwks !== null) {
    jwks = target.jwks;
  } else if (target.jwksUri !== null) {
    try {
      jwks = await deps.clientKeySet.fetch(target.jwksUri, realmId);
    } catch (err) {
      return {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'jwks_uri fetch failed',
      };
    }
  } else {
    return { kind: 'unavailable', reason: 'client publishes no keys to encrypt for' };
  }

  const parsed = asJwks(jwks);
  if (parsed === null) {
    return { kind: 'unavailable', reason: 'client keys did not answer with a JWK Set' };
  }

  // No candidate, two equally good ones, or one the filters reject — all
  // three read the same here (docs/superpowers/p3b-spike-jwe.md, "Key
  // selection from a client's JWKS"): an ambiguous or absent choice is not
  // this server's to make silently.
  const key = selectEncryptionKey(parsed, target.alg);
  if (key === null) {
    return { kind: 'unavailable', reason: 'no unambiguous encryption key in the client JWKS' };
  }

  const nested = body.kind === 'jwt';
  const payload = nested ? body.token : JSON.stringify(body.claims);
  try {
    const token = await encryptCompact(payload, key, target.alg, target.enc, { nested });
    return { kind: 'body', body: { kind: 'jwt', token } };
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: err instanceof Error ? err.message : 'encryption failed',
    };
  }
}
