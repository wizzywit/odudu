import { type SessionLifespans } from '@odudu/authn-flows';
import { verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type TenantLookup, type TokenGrantRecord } from '@odudu/protocol-oidc';
import { tenantIssuer } from '#/service/issuer';

export interface AdminPrincipal {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly clientDbId: string;
}

export type AdminAuthOutcome =
  | { kind: 'authenticated'; principal: AdminPrincipal }
  // `reason` is for logging only — the route never puts it in a response
  // body, so a caller cannot use it to learn which step refused them.
  | { kind: 'unauthenticated'; reason: string };

export interface AuthenticateAdminDeps {
  // Fixed for the whole deployment. See #/service/issuer.ts.
  issuerBase: string;
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
  const segment = token.split('.')[1];
  if (segment === undefined || segment.length === 0) return undefined;
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

function lifespansOf(tenant: TenantLookup): SessionLifespans {
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
  targetTenantName: string,
  iss: string,
): Promise<MatchedTenant | undefined> {
  const targetIssuer = tenantIssuer(deps.issuerBase, targetTenantName);
  const systemIssuer = tenantIssuer(deps.issuerBase, SYSTEM_TENANT_NAME);

  const name =
    iss === targetIssuer ? targetTenantName : iss === systemIssuer ? SYSTEM_TENANT_NAME : undefined;
  if (name === undefined) return undefined;

  const tenant = await deps.findTenant(name);
  if (!tenant?.enabled) return undefined;
  return { id: tenant.id, lifespans: lifespansOf(tenant) };
}

export async function authenticateAdmin(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
): Promise<AdminAuthOutcome> {
  const token = extractBearerToken(input.authorizationHeader);
  if (token === undefined) return unauthenticated('missing_credentials');

  const iss = unverifiedIssuer(token);
  if (iss === undefined) return unauthenticated('malformed_token');

  const matched = await matchIssuer(deps, input.targetTenantName, iss);
  if (matched === undefined) return unauthenticated('issuer_mismatch');

  const keys = await deps.listPublishableKeys(matched.id);
  let payload;
  try {
    payload = await verifyJwt(token, { keys, issuer: iss, audience: `${iss}/admin`, typ: 'at+jwt' });
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

  const sid = payload.sid;
  if (typeof sid !== 'string' || sid.length === 0) return unauthenticated('invalid_token');
  const live = await deps.isSessionLive(matched.id, sid, matched.lifespans, input.now);
  if (!live) return unauthenticated('dead_session');

  const enabled = await deps.isClientEnabled(matched.id, grant.clientId);
  if (!enabled) return unauthenticated('client_disabled');

  return {
    kind: 'authenticated',
    principal: { subjectId: payload.sub, issuerTenantId: matched.id, clientDbId: grant.clientId },
  };
}
