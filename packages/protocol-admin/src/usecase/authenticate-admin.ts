import { type SessionLifespans } from '@odudu/authn-flows';
import { verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import {
  ADMIN_API_AUDIENCE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  SYSTEM_TENANT_NAME,
} from '@odudu/domain-tenant';
import {
  narrowActClaim,
  tenantIssuer,
  type AcceptedIssuersLookup,
  type TenantLookup,
  type TokenGrantRecord,
} from '@odudu/protocol-oidc';

export interface AdminPrincipal {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly clientDbId: string;
  // The token's `scope` claim, split; empty when it carries none.
  readonly scopes: readonly string[];
  // Present when the token was minted for an AI agent acting for `subjectId`.
  readonly agent?: AdminAgent;
}

export interface AdminAgent {
  readonly clientId: string;
  readonly ownerSubjectId: string;
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
    }
  // An agent token is the owner's identity narrowed to what its MCP scope
  // grants; one holding no MCP scope has nothing to narrow it and is refused.
  | { kind: 'forbidden'; reason: 'agent_without_mcp_scope'; principal: AdminPrincipal };

export interface ClientState {
  readonly enabled: boolean;
  readonly builtinMcp: boolean;
  readonly builtinAdmin: boolean;
}

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
  // `builtinMcp` is the `builtin_mcp` marker, never the client_id string.
  loadClientState(tenantId: string, clientDbId: string): Promise<ClientState | null>;
  isSubjectEnabled(tenantId: string, subjectId: string): Promise<boolean>;
  // The issuers a token for this tenant may carry: its canonical address and
  // any it left whose window is open, the set /userinfo checks against.
  acceptedIssuers: AcceptedIssuersLookup;
  // The tenant a verified host serves right now, canonical or inside its
  // window, for a foreign token that names a domain.
  tenantNameAtHost(host: string, now: Date): Promise<string | null>;
}

export interface AuthenticateAdminInput {
  authorizationHeader: string | undefined;
  targetTenantName: string;
  // The row `targetTenantName` resolves to, as the caller has already read it,
  // so it is not read a second time here.
  targetTenant: TenantLookup;
  // The whole strings this door accepts as `iss`: the target tenant's accepted
  // set (`deps.acceptedIssuers`, seeded with this request's own issuer for the
  // tenant, which stands for all of it where no base URL is configured) and the
  // system tenant's, resolved by the caller the way /userinfo resolves its own
  // (`tenantIssuerFor`, `@odudu/protocol-oidc`) — kept out of this usecase so
  // it stays free of the Fastify request type that computes them.
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
// exact string match against the issuers this door accepts — never by
// trusting the path alone. A system-tenant token presented at another
// tenant's path names the system tenant's issuer and must resolve to it,
// not to the path tenant it was never minted for. The system tenant cannot
// have a domain, so its one issuer is never looked up.
async function namesTarget(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  iss: string,
): Promise<boolean> {
  if (input.targetTenantName === SYSTEM_TENANT_NAME) return iss === input.targetTenantIssuer;
  if (iss === input.systemTenantIssuer) return false;
  const accepted = await deps.acceptedIssuers(
    { id: input.targetTenant.id, name: input.targetTenantName },
    input.targetTenantIssuer,
    input.now,
  );
  return accepted.includes(iss);
}

async function matchIssuer(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  iss: string,
): Promise<MatchedTenant | undefined> {
  const name = (await namesTarget(deps, input, iss))
    ? input.targetTenantName
    : iss === input.systemTenantIssuer
      ? SYSTEM_TENANT_NAME
      : undefined;
  if (name === undefined) return undefined;

  const tenant = name === input.targetTenantName ? input.targetTenant : await deps.findTenant(name);
  if (!tenant?.enabled) return undefined;
  return { id: tenant.id, lifespans: lifespansOf(tenant) };
}

function bareOriginHost(iss: string): string | undefined {
  try {
    const url = new URL(iss);
    return url.origin === iss ? url.host : undefined;
  } catch {
    return undefined;
  }
}

async function foreignTenantName(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  iss: string,
): Promise<string | undefined> {
  const prefix = tenantIssuer(input.issuerBase, '');
  if (iss.startsWith(prefix)) {
    const name = iss.slice(prefix.length);
    return name.length === 0 || name.includes('/') ? undefined : name;
  }
  const host = bareOriginHost(iss);
  if (host === undefined) return undefined;
  return (await deps.tenantNameAtHost(host, input.now)) ?? undefined;
}

// Resolves an issuer neither of the two above, only to learn whether a
// tenant here really signed it. The answer changes no response.
async function resolveForeignIssuer(
  deps: AuthenticateAdminDeps,
  input: AuthenticateAdminInput,
  token: string,
  iss: string,
): Promise<ForeignIssuer | undefined> {
  const name = await foreignTenantName(deps, input, iss);
  if (name === undefined) return undefined;

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

function readScopes(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (typeof value !== 'string') return undefined;
  return value.split(' ').filter((scope) => scope.length > 0);
}

const MCP_SCOPES: readonly string[] = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];

interface AgentClaims {
  readonly scopes: readonly string[];
  readonly actorClientId: string | undefined;
}

// `undefined` when `scope` or `act` is present and malformed: a claim that
// narrows what a token may do is refused when unreadable, never ignored.
function readAgentClaims(payload: Record<string, unknown>): AgentClaims | undefined {
  const scopes = readScopes(payload.scope);
  if (scopes === undefined) return undefined;
  if (payload.act === undefined) return { scopes, actorClientId: undefined };
  const act = narrowActClaim(payload.act);
  return act === null ? undefined : { scopes, actorClientId: act.sub };
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

  const claims = readAgentClaims(payload);
  if (claims === undefined) return unauthenticated('invalid_token');

  const grantId = payload.grant_id;
  if (typeof grantId !== 'string' || grantId.length === 0) {
    return unauthenticated('invalid_token');
  }
  const grant = await deps.loadGrant(matched.id, grantId);
  if (grant?.revokedAt !== null) return unauthenticated('invalid_grant');

  // A client_credentials grant has no session at all, which is not a dead
  // one: a service account is refused here only if its grant is revoked,
  // its client disabled or its subject disabled.
  if (grant.sessionId !== null) {
    const sid = payload.sid;
    if (typeof sid !== 'string' || sid.length === 0) return unauthenticated('invalid_token');
    const live = await deps.isSessionLive(matched.id, sid, matched.lifespans, input.now);
    if (!live) return unauthenticated('dead_session');
  }

  const client = await deps.loadClientState(matched.id, grant.clientId);
  if (client?.enabled !== true) return unauthenticated('client_disabled');

  // Disabling a subject ends nothing it holds, so an access token issued
  // before is refused here rather than living out its lifetime.
  if (!(await deps.isSubjectEnabled(matched.id, payload.sub))) {
    return unauthenticated('subject_disabled');
  }

  const holdsMcpScope = claims.scopes.some((scope) => MCP_SCOPES.includes(scope));
  const isAgent = claims.actorClientId !== undefined || holdsMcpScope || client.builtinMcp;

  const base = {
    subjectId: payload.sub,
    issuerTenantId: matched.id,
    clientDbId: grant.clientId,
    scopes: claims.scopes,
  };
  if (!isAgent) return { kind: 'authenticated', principal: base };
  if (!holdsMcpScope) {
    return { kind: 'forbidden', reason: 'agent_without_mcp_scope', principal: base };
  }

  const clientId = claims.actorClientId ?? payload.client_id;
  if (typeof clientId !== 'string' || clientId.length === 0) {
    return unauthenticated('invalid_token');
  }
  return {
    kind: 'authenticated',
    principal: { ...base, agent: { clientId, ownerSubjectId: payload.sub } },
  };
}
