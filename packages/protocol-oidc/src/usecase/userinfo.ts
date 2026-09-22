import { encodeUnsecuredJwt, signJwt, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { type ClaimMapperRegistry } from '@odudu/kernel';
import { presentedBearerToken } from '#/service/bearer-token';
import { type ClaimContext } from '#/service/claims';
import { narrowByScopeMappings } from '#/service/scope-mapping';
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
  kek: Uint8Array;
}

export type UserinfoBody =
  { kind: 'json'; claims: Record<string, unknown> } | { kind: 'jwt'; token: string };

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
  const responseBody = await signedBody(deps, realm.id, issuer, clientId, claims);
  return { kind: 'ok', body: responseBody, clientId };
}

// OIDC Core §5.3.2. `aud`, `none` and `typ` each carry a decision that reads
// as obvious by analogy with a token that looks similar and is not — see
// "A signed UserInfo response: `aud`, `none`, `typ`, and the algorithm that
// was never selectable" in docs/protocols/oidc-core.md before changing this.
async function signedBody(
  deps: UserinfoDeps,
  realmId: string,
  issuer: string,
  clientId: string | undefined,
  claims: Record<string, unknown>,
): Promise<UserinfoBody> {
  if (clientId === undefined) return { kind: 'json', claims };

  const alg = await deps.userinfoSignedResponseAlg(realmId, clientId);
  if (alg === null) return { kind: 'json', claims };

  const signedClaims = { ...claims, iss: issuer, aud: clientId };
  if (alg === 'none') {
    return { kind: 'jwt', token: encodeUnsecuredJwt(signedClaims) };
  }

  // No `typ`: an ID Token carries none (OIDC Core §2), and nothing in JWA
  // or OIDC Core assigns a UserInfo JWT one either — RFC 9068's `at+jwt` is
  // specific to OAuth access tokens (§2.1), and reusing it here would claim
  // this token is one.
  const key = await deps.activeSigningKey(realmId);
  const token = await signJwt(signedClaims, { key, kek: deps.kek });
  return { kind: 'jwt', token };
}
