import { type SessionLifespans } from '@odudu/authn-flows';
import { AUDIENCE_UNCHECKED, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { clientIsLive, type LiveClientLookup } from '#/service/client-enabled';
import {
  audienceOf,
  callerIsAddressed,
  type IntrospectionCaller,
} from '#/service/introspection-audience';

export interface IntrospectionGrant {
  readonly revokedAt: Date | null;
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
  readonly tenantId: string;
  readonly issuer: string;
  readonly keys: readonly SigningKeyRecord[];
  readonly lifespans: SessionLifespans;
  // Keyed by the token's own private `grant_id` claim — see
  // `mintAccessToken`'s comment on why nothing else identifies one row.
  loadGrant(grantId: string): Promise<IntrospectionGrant | null>;
  isSessionLive(sessionId: string, lifespans: SessionLifespans, now: Date): Promise<boolean>;
  readonly liveClientLookup: LiveClientLookup;
}

const INACTIVE: IntrospectionResponse = { active: false };

// RFC 7662 §2.2/§2.3: every reason a token is not described — a signature
// that does not verify, a grant this server has revoked or never minted a
// `grant_id` for, a session that has ended before the token's own `exp`,
// or a caller not named in `aud` — answers the identical `{ active: false
// }`, with no further member. An introspection response that varied would
// itself be the oracle §2.2's SHOULD NOT exists to close.
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
      // The caller's entitlement is an intersection against its own
      // registered identities (`callerIsAddressed`,
      // `#/service/introspection-audience.ts`) — a rule verification
      // itself cannot express, since it depends on who is asking rather
      // than on the token alone. This declares that deliberately, per
      // AUDIENCE_UNCHECKED's own contract (packages/crypto/src/service/sign.ts).
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
  } catch {
    return INACTIVE;
  }

  const { client_id: clientId, sub, scope, sid, grant_id: grantId } = payload;
  if (typeof clientId !== 'string' || clientId.length === 0) return INACTIVE;
  if (typeof sub !== 'string' || sub.length === 0) return INACTIVE;
  if (typeof scope !== 'string') return INACTIVE;
  // A token minted before `grant_id` existed carries none — fail closed
  // rather than fall back to any query that could match a sibling grant.
  if (typeof grantId !== 'string' || grantId.length === 0) return INACTIVE;

  const sessionId = typeof sid === 'string' && sid.length > 0 ? sid : null;

  const grant = await deps.loadGrant(grantId);
  if (grant === null) return INACTIVE;
  if (grant.revokedAt !== null) return INACTIVE;

  // A disabled client's tokens describe nothing — the same failure mode
  // as a revoked grant, checked the same way `/userinfo` and token
  // exchange check it.
  if (!clientIsLive(await deps.liveClientLookup.findLiveClient(deps.tenantId, clientId))) {
    return INACTIVE;
  }

  // Session liveness is what makes revocation real inside an access
  // token's hour (design spec §8.2): a self-contained `at+jwt` is accepted
  // on its signature alone everywhere else, so this is the one place a
  // logout can still be observed before `exp`. An `offline_access` grant
  // carries no session — `sessionId` is `null` — and must not be reported
  // dead for lacking one.
  if (sessionId !== null) {
    const live = await deps.isSessionLive(sessionId, deps.lifespans, now);
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
