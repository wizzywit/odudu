import { type SessionLifespans } from '@odudu/authn-flows';
import { verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { ADMIN_API_AUDIENCE, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { tenantIssuer, type TenantLookup, type TokenGrantRecord } from '@odudu/protocol-oidc';

export interface AdminPrincipal {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly clientDbId: string;
}

// A genuine token from another tenant of this deployment, presented at a
// tenant it was never minted for: refused, and recorded (ADR 0037).
export interface ForeignIssuer {
  readonly issuerTenantId: string;
  readonly subjectId: string;
  readonly clientDbId: string | null;
}

export type AdminAuthOutcome =
  | { kind: 'authenticated'; principal: AdminPrincipal }
  // `reason` is for logging only — the route never puts it in a response
  // body, so a caller cannot use it to learn which step refused them.
  | {
      kind: 'unauthenticated';
      reason: string;
      foreignIssuer?: ForeignIssuer;
      // Why a foreign issuer could not be resolved, for the log alone: the
      // response is the same plain refusal whatever it was.
      foreignIssuerError?: unknown;
    };

export interface AuthenticateAdminDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  loadGrant(tenantId: string, grantId: string): Promise<TokenGrantRecord | null>;
  isSessionLive(
    tenantId: string,
    sessionId: string,
    lifespans: SessionLifespans,
    now: Date,
  ): Promise<boolean>;
  isClientEnabled(tenantId: string, clientDbId: string): Promise<boolean>;
}

export interface AuthenticateAdminInput {
  authorizationHeader: string | undefined;
  targetTenantName: string;
  // The two whole strings this door accepts as `iss`, resolved by the
  // caller the same way /userinfo resolves the one it checks against
  // (`tenantIssuerFor`, `@odudu/protocol-oidc`) — kept out of this usecase
  // so it stays free of the Fastify request type that computes them.
  targetTenantIssuer: string;
  systemTenantIssuer: string;
  issuerBase: string;
  now: Date;
}

const BEARER_PATTERN = /^Bearer\s+(.+)$/iu;

function extractBearerToken(header: string | undefined): string | undefined {
  const match = header === undefined ? null : BEARER_PATTERN.exec(header);
  const token = match?.[1];
  return token !== undefined && token.length > 0 ? token : undefined;
}

// Read before the signature verifies, only to decide which tenant's keys
// to verify against (spec §7 step 1) — trusted for nothing else, and
// re-read from the verified payload once the signature checks out.
function unverifiedIssuer(token: string): string | undefined {
  const segments = token.split('.');
  const segment = segments[1];
  if (segments.length !== 3 || segment === undefined || segment.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const iss = (parsed as Record<string, unknown>).iss;
  return typeof iss === 'string' && iss.length > 0 ? iss : undefined;
}

function unauthenticated(reason: string): AdminAuthOutcome {
  return { kind: 'unauthenticated', reason };
}

interface MatchedTenant {
  readonly id: string;
  readonly lifespans: SessionLifespans;
}

// Exported so every assembler of a liveness decision's inputs — this
// module's own authentication check and `#/usecase/sessions.ts`'s
// listing — builds `SessionLifespans` from `TenantLookup` the one way.
export function lifespansOf(tenant: TenantLookup): SessionLifespans {
  return {
    ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
    ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
    rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
    rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
  };
}

// Which tenant's keys the signature verifies against is decided here, by
// exact string match against the two issuers this door accepts — never by
// trusting the path alone. A system-tenant token presented at another
// tenant's path names the system tenant's issuer and must resolve to it,
// not to the path tenant it was never minted for.
async function matchIssuer(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  iss: string,
): Promise<MatchedTenant | undefined> {
  const name =
    iss === input.targetTenantIssuer
      ? input.targetTenantName
      : iss === input.systemTenantIssuer
        ? SYSTEM_TENANT_NAME
        : undefined;
  if (name === undefined) return undefined;

  const tenant = await deps.findTenant(name);
  if (!tenant?.enabled) return undefined;
  return { id: tenant.id, lifespans: lifespansOf(tenant) };
}

// Resolves an issuer neither of the two above, only to learn whether a
// tenant here really signed it. The answer changes no response.
async function resolveForeignIssuer(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  token: string,
  iss: string,
): Promise<ForeignIssuer | undefined> {
  const prefix = tenantIssuer(input.issuerBase, '');
  if (!iss.startsWith(prefix)) return undefined;
  const name = iss.slice(prefix.length);
  if (name.length === 0 || name.includes('/')) return undefined;

  const tenant = await deps.findTenant(name);
  if (!tenant?.enabled) return undefined;

  const keys = await deps.listPublishableKeys(tenant.id);
  let payload;
  try {
    payload = await verifyJwt(token, {
      keys,
      issuer: iss,
      audience: ADMIN_API_AUDIENCE,
      typ: 'at+jwt',
    });
  } catch {
    return undefined;
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return undefined;

  const grantId = payload.grant_id;
  const grant =
    typeof grantId === 'string' && grantId.length > 0
      ? await deps.loadGrant(tenant.id, grantId)
      : null;
  return { issuerTenantId: tenant.id, subjectId: payload.sub, clientDbId: grant?.clientId ?? null };
}

export async function authenticateAdmin(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
): Promise<AdminAuthOutcome> {
  const token = extractBearerToken(input.authorizationHeader);
  if (token === undefined) return unauthenticated('missing_credentials');

  const iss = unverifiedIssuer(token);
  if (iss === undefined) return unauthenticated('malformed_token');

  const matched = await matchIssuer(deps, input, iss);
  if (matched === undefined) {
    let foreignIssuer: ForeignIssuer | undefined;
    try {
      foreignIssuer = await resolveForeignIssuer(deps, input, token, iss);
    } catch (foreignIssuerError) {
      return { kind: 'unauthenticated', reason: 'issuer_mismatch', foreignIssuerError };
    }
    return foreignIssuer === undefined
      ? unauthenticated('issuer_mismatch')
      : { kind: 'unauthenticated', reason: 'issuer_mismatch', foreignIssuer };
  }

  const keys = await deps.listPublishableKeys(matched.id);
  let payload;
  try {
    payload = await verifyJwt(token, {
      keys,
      issuer: iss,
      audience: ADMIN_API_AUDIENCE,
      typ: 'at+jwt',
    });
  } catch {
    return unauthenticated('invalid_token');
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return unauthenticated('invalid_token');
  }

  const grantId = payload.grant_id;
  if (typeof grantId !== 'string' || grantId.length === 0) {
    return unauthenticated('invalid_token');
  }
  const grant = await deps.loadGrant(matched.id, grantId);
  if (grant?.revokedAt !== null) return unauthenticated('invalid_grant');

  // A client_credentials grant has no session at all, which is not a dead
  // one: a service account is refused here only if its grant is revoked or
  // its client disabled.
  if (grant.sessionId !== null) {
    const sid = payload.sid;
    if (typeof sid !== 'string' || sid.length === 0) return unauthenticated('invalid_token');
    const live = await deps.isSessionLive(matched.id, sid, matched.lifespans, input.now);
    if (!live) return unauthenticated('dead_session');
  }

  const enabled = await deps.isClientEnabled(matched.id, grant.clientId);
  if (!enabled) return unauthenticated('client_disabled');

  return {
    kind: 'authenticated',
    principal: { subjectId: payload.sub, issuerTenantId: matched.id, clientDbId: grant.clientId },
  };
}
