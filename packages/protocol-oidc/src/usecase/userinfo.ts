import { verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { type ClaimMapperRegistry } from '@odudu/kernel';
import { presentedBearerToken } from '#/service/bearer-token';
import { type ClaimContext } from '#/service/claims';
import { type RealmLookup } from '#/repository/realm-lookup';

export interface UserinfoDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  loadClaimContext(realmId: string, subjectId: string): Promise<ClaimContext>;
  claimMappers: ClaimMapperRegistry<ClaimContext>;
}

export type UserinfoOutcome =
  | { kind: 'not_found' }
  // No Authorization header at all: RFC 6750 §3.1 SHOULD omits an error
  // code here, distinct from a header that was present but rejected.
  | { kind: 'missing_credentials' }
  // The token arrived by more than one method, or twice by one. RFC 6750
  // §3.1 gives this `invalid_request`, and §3.1's HTTP 400.
  | { kind: 'invalid_request' }
  | { kind: 'invalid_token' }
  | { kind: 'insufficient_scope' }
  | { kind: 'ok'; claims: Record<string, unknown> };

function scopesOf(scopeClaim: unknown): string[] {
  return typeof scopeClaim === 'string'
    ? scopeClaim.split(' ').filter((token) => token.length > 0)
    : [];
}

// Validation order, matching RFC 9068 §4 and RFC 6750 §3.1: signature and
// `kid` (inside verifyJwt) → `typ: at+jwt` (also verifyJwt — this is what
// stops an ID Token, signed by the same key at the same moment, being
// presented here) → `iss` → `exp` → `aud` contains this issuer (verifyJwt's
// `audience` option, checked against jose's claim checks — a token whose
// `aud` is an array is accepted as long as the issuer is one of its
// members, never dropped to a bare string match) → and only once the
// token itself is genuinely valid, the `openid` scope check, reported as
// a distinct 403 rather than folded into the same 401 an attacker could
// use to distinguish "bad token" from "valid token, wrong scope".
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

  const scope = scopesOf(payload.scope);
  if (!scope.includes('openid')) return { kind: 'insufficient_scope' };

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { kind: 'invalid_token' };
  }

  const ctx = await deps.loadClaimContext(realm.id, payload.sub);
  const claims = await deps.claimMappers.assemble(scope, ctx);
  return { kind: 'ok', claims };
}
