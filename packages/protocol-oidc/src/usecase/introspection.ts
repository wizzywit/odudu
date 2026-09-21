import { AUDIENCE_UNCHECKED, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';

// The token's own identity, as loaded off the grant its claims name.
// `sessionId` is `null` for an `offline_access` grant, which token-issuance
// (`packages/protocol-oidc/src/usecase/token-issuance.ts`) never binds to a
// session — see `mintAccessToken`'s `sid` comment.
export interface GrantIdentity {
  readonly clientId: string;
  readonly subjectId: string;
  readonly sessionId: string | null;
}

export interface IntrospectionGrant {
  readonly revokedAt: Date | null;
}

// RFC 7662 §2.2 leaves "the caller" undefined beyond "a protected
// resource"; the phase spec's own §8.2 sentence compares that caller
// against a bare `client_id`, but a token's `aud` is built from RFC 8707
// resource URIs (`client_oidc_config.audiences`), a different namespace
// from the `client_id` a `/introspect` caller authenticates with. So the
// caller carries both of its own identities — the `client_id` a deployment
// may have registered as a resource URI too, and the `audiences` a
// resource server actually names itself with — and either is enough to
// entitle it to a description. Named as its own type so a call site cannot
// hand this function a bare string and have it compile.
export interface IntrospectionCaller {
  readonly clientId: string;
  readonly audiences: readonly string[];
}

export interface IntrospectionInput {
  readonly token: string;
  readonly caller: IntrospectionCaller;
}

export type IntrospectionResponse =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly scope: string;
      readonly client_id: string;
      readonly sub: string;
      readonly aud: string[];
      readonly token_type: 'Bearer';
      readonly exp: number;
      readonly iat: number;
    };

export interface IntrospectionDeps {
  readonly issuer: string;
  readonly keys: readonly SigningKeyRecord[];
  readonly idleSeconds: number;
  loadGrant(identity: GrantIdentity): Promise<IntrospectionGrant | null>;
  isSessionLive(sessionId: string, idleSeconds: number, now: Date): Promise<boolean>;
}

const INACTIVE: IntrospectionResponse = { active: false };

function audienceOf(aud: unknown): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud) && aud.every((entry): entry is string => typeof entry === 'string')) {
    return aud;
  }
  return [];
}

// True when the caller is entitled to a description of this token: its own
// `client_id`, or any resource URI it is registered under, is named in the
// token's `aud`. See `IntrospectionCaller`'s doc comment for why the two
// identities are checked together.
function callerIsAddressed(caller: IntrospectionCaller, aud: readonly string[]): boolean {
  const identities = [caller.clientId, ...caller.audiences];
  return identities.some((identity) => aud.includes(identity));
}

// RFC 7662 §2.2/§2.3: every reason a token is not described — a signature
// that does not verify, a grant this server has revoked, a session that
// has ended before the token's own `exp`, or a caller not named in `aud` —
// answers the identical `{ active: false }`, with no further member. An
// introspection response that varied would itself be the oracle §2.2's
// SHOULD NOT exists to close.
export async function introspect(
  deps: IntrospectionDeps,
  input: IntrospectionInput,
  now: Date,
): Promise<IntrospectionResponse> {
  let payload;
  try {
    payload = await verifyJwt(input.token, {
      keys: [...deps.keys],
      issuer: deps.issuer,
      // Introspection verifies a token issued by this realm; it is not
      // itself a resource server the token was minted for, so it has no
      // principal of its own to check `aud` against here — that check is
      // `callerIsAddressed`, below, against the caller's identity rather
      // than the issuer's. Mirrors `AUDIENCE_UNCHECKED`'s other declared
      // use at /logout's `id_token_hint` (packages/crypto/src/service/sign.ts).
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
  } catch {
    return INACTIVE;
  }

  const { client_id: clientId, sub, scope, sid } = payload;
  if (typeof clientId !== 'string' || clientId.length === 0) return INACTIVE;
  if (typeof sub !== 'string' || sub.length === 0) return INACTIVE;
  if (typeof scope !== 'string') return INACTIVE;

  const sessionId = typeof sid === 'string' && sid.length > 0 ? sid : null;

  const grant = await deps.loadGrant({ clientId, subjectId: sub, sessionId });
  if (grant === null) return INACTIVE;
  if (grant.revokedAt !== null) return INACTIVE;

  // Session liveness is what makes revocation real inside an access
  // token's hour (design spec §8.2): a self-contained `at+jwt` is accepted
  // on its signature alone everywhere else, so this is the one place a
  // logout can still be observed before `exp`. An `offline_access` grant
  // carries no session — `sessionId` is `null` — and must not be reported
  // dead for lacking one.
  if (sessionId !== null) {
    const live = await deps.isSessionLive(sessionId, deps.idleSeconds, now);
    if (!live) return INACTIVE;
  }

  const aud = audienceOf(payload.aud);
  if (!callerIsAddressed(input.caller, aud)) return INACTIVE;

  const { exp, iat } = payload;
  if (typeof exp !== 'number' || typeof iat !== 'number') return INACTIVE;

  return {
    active: true,
    scope,
    client_id: clientId,
    sub,
    aud,
    token_type: 'Bearer',
    exp,
    iat,
  };
}
