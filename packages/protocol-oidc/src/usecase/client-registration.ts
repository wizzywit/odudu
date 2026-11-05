import { signingKeyRepository } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clientRepository,
  assignMcpScope,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { addressUrl, MCP_RESOURCE_PATH, newId, type TenantAddress } from '@odudu/kernel';
import { randomBytes } from 'node:crypto';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { extractBearerToken } from '#/service/bearer-token';
import { parseClientMetadata, type ClientMetadata } from '#/service/client-metadata';
import {
  audiencesUnderPolicy,
  decideMcpRegistration,
  type McpPolicyGrant,
} from '#/service/mcp-registration-policy';
import { MCP_READ_SCOPE } from '#/service/mcp-scopes';
import {
  type RegistrationBudgetScope,
  type RegistrationLimiter,
} from '#/service/registration-throttle';
import { parseLocalisedClientNames } from '#/service/localised-client-names';
import { idTokenAlgUnavailable } from '#/usecase/id-token-alg';

export interface ClientRegistrationDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // Everything past tenant resolution runs inside one tenant-scoped
  // transaction: spending the token, taking the cap under its lock, and
  // the two inserts. A failure anywhere rolls all of it back together.
  withinTenant<T>(tenantId: string, fn: (tx: TenantScopedDatabase) => Promise<T>): Promise<T>;
  hashClientSecret(secret: string): Promise<string>;
  now(): Date;
  // Gates `tls_client_auth` registrations the same way `/token` gates
  // authenticating with one — see `parseClientMetadata`'s own
  // `tlsClientAuthEnabled` for the design decision this honours.
  tlsClientAuthEnabled: boolean;
  // Consulted only for a tenant on the `mcp` policy, which stays closed
  // where none is wired: open registration with no budget is not a default.
  mcpRegistrationLimiter?: RegistrationLimiter | undefined;
}

// What the request itself says about where it came from.
export interface RegistrationContext {
  // The client address the throttle keys on.
  readonly origin: string;
  // The tenant's own address, whose MCP URL the `mcp` policy binds to.
  readonly address: TenantAddress;
}

export interface RegisteredClient {
  clientId: string;
  clientIdIssuedAt: number;
  clientSecret: string | null;
  // The audiences the policy gave it; empty for every policy but `mcp`.
  audiences: string[];
  metadata: ClientMetadata;
  // `client_name#<tag>` members the tenant offers, by canonical tag.
  nameI18n: Record<string, string>;
}

export type ClientRegistrationOutcome =
  | { kind: 'not_found' }
  | { kind: 'unauthorized' }
  | { kind: 'invalid_token' }
  | {
      kind: 'invalid_metadata';
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    }
  | { kind: 'at_capacity' }
  | { kind: 'rate_limited'; retryAfterSeconds: number; scope: RegistrationBudgetScope }
  | { kind: 'ok'; client: RegisteredClient };

// RFC 7591 places no format requirement on a client secret; 32 random bytes
// base64url-encoded matches the registration token's own choice
// (packages/domain-tenant/src/repository/client-registration-tokens.ts) —
// 256 bits of entropy, comfortably above what a bearer credential needs.
function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

function clientType(tokenEndpointAuthMethod: string): 'public' | 'confidential' {
  return tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
}

// One transaction, entered only once the tenant is known to accept
// registrations at all — a disabled tenant and an unknown one both stop at
// `not_found` before any transaction opens.
async function performRegistration(
  deps: ClientRegistrationDeps,
  tx: TenantScopedDatabase,
  tenantId: string,
  metadata: ClientMetadata,
  nameI18n: Record<string, string>,
  origin: ClientRecord['registrationOrigin'],
  now: Date,
  grant: McpPolicyGrant | null,
): Promise<ClientRegistrationOutcome> {
  const capacity = await clientRepository(tx).lockCapacity(tenantId);
  if (capacity.count >= capacity.maxClients) {
    return { kind: 'at_capacity' };
  }

  // Checked against every algorithm a non-retired key produces, not only
  // the active one: a key staged as `rotating` (the admin API's `POST
  // /keys`, packages/protocol-admin/src/usecase/keys.ts) must let a client
  // register against its algorithm before that key is promoted, or no
  // client could ever move first and rotation could never begin.
  if (
    metadata.userinfoSignedResponseAlg !== null &&
    metadata.userinfoSignedResponseAlg !== 'none'
  ) {
    const available = await signingKeyRepository(tx).algorithmsAvailable();
    if (!available.includes(metadata.userinfoSignedResponseAlg)) {
      return {
        kind: 'invalid_metadata',
        error: 'invalid_client_metadata',
        description: `userinfo_signed_response_alg ${metadata.userinfoSignedResponseAlg} is not produced by any of this tenant's signing keys (${available.join(', ') || 'none'})`,
      };
    }
  }

  const idTokenAlg = await idTokenAlgUnavailable(tx, metadata.idTokenSignedResponseAlg);
  if (idTokenAlg !== null) {
    return { kind: 'invalid_metadata', error: 'invalid_client_metadata', description: idTokenAlg };
  }

  // jwks_uri is validated for shape only, by parseClientMetadata
  // (assertFetchableUrl) — never dereferenced here. The key is not needed
  // until `authenticatePrivateKeyJwt` (usecase/token-issuance.ts) fetches
  // it at request time; dereferencing at registration would make a
  // registration's success depend on a socket to a host the registrant
  // does not control being up at that instant, and never again — the
  // opposite of what a registration is for. docs/phases/p3a.md records the
  // registration-time attempt that was reverted, and why.
  const type = clientType(metadata.tokenEndpointAuthMethod);

  let serviceSubjectId: string | null = null;
  if (type === 'confidential') {
    const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
    serviceSubjectId = serviceSubject.id;
  }

  const clientSecret = type === 'confidential' ? generateClientSecret() : null;
  const secretHash = clientSecret === null ? null : await deps.hashClientSecret(clientSecret);

  const oauthClientId = newId();
  const client = await clientRepository(tx).create({
    tenantId,
    clientId: oauthClientId,
    name: metadata.clientName ?? oauthClientId,
    nameI18n,
    type,
    secretHash,
    serviceSubjectId,
    registrationOrigin: origin,
  });

  await provisionClientDefaults(tx, client.id);
  if (grant !== null) await assignMcpScope(tx, client.id, MCP_READ_SCOPE, 'optional');

  const audiences = grant === null ? [] : audiencesUnderPolicy([], grant.audience, grant.granted);
  await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId,
    audiences,
    accessTokenTtlSeconds: null,
    refreshTokenTtlSeconds: null,
    redirectUris: metadata.redirectUris,
    grantTypes: metadata.grantTypes,
    tokenEndpointAuthMethod:
      metadata.tokenEndpointAuthMethod as ClientOidcConfig['tokenEndpointAuthMethod'],
    jwks: metadata.jwks,
    jwksUri: metadata.jwksUri,
    frontchannelLogoutUri: metadata.frontchannelLogoutUri,
    backchannelLogoutUri: metadata.backchannelLogoutUri,
    backchannelLogoutSessionRequired: metadata.backchannelLogoutSessionRequired,
    frontchannelLogoutSessionRequired: metadata.frontchannelLogoutSessionRequired,
    // The one axis this defaults on for: an anonymous registration is
    // untrusted the way a seeded or token-authorized client is not (ADR
    // 0027, RFC 7591 §5).
    consentRequired: origin === 'anonymous' || grant !== null,
    userinfoSignedResponseAlg: metadata.userinfoSignedResponseAlg,
    userinfoEncryptedResponseAlg: metadata.userinfoEncryptedResponseAlg,
    userinfoEncryptedResponseEnc: metadata.userinfoEncryptedResponseEnc,
    tlsClientAuthSubjectDn: metadata.tlsClientAuthSubjectDn,
    clientUri: metadata.clientUri,
    policyUri: metadata.policyUri,
    tosUri: metadata.tosUri,
    idTokenSignedResponseAlg: metadata.idTokenSignedResponseAlg,
    defaultMaxAge: metadata.defaultMaxAge,
    requireAuthTime: metadata.requireAuthTime,
  });

  return {
    kind: 'ok',
    client: {
      clientId: oauthClientId,
      clientIdIssuedAt: Math.floor(now.getTime() / 1000),
      clientSecret,
      audiences,
      metadata,
      nameI18n,
    },
  };
}

interface ParsedRegistration {
  readonly metadata: ClientMetadata;
  readonly names: Record<string, string>;
}

function parseRegistration(
  deps: ClientRegistrationDeps,
  tenant: TenantLookup,
  body: unknown,
): ParsedRegistration | Extract<ClientRegistrationOutcome, { kind: 'invalid_metadata' }> {
  const parsed = parseClientMetadata(body, {
    tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
    refuseOperatorFields: true,
  });
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid_metadata', error: parsed.error, description: parsed.description };
  }

  // parseClientMetadata has shown the body is an object.
  const names = parseLocalisedClientNames(body as Record<string, unknown>, tenant.supportedLocales);
  if (names.kind === 'invalid') {
    return {
      kind: 'invalid_metadata',
      error: 'invalid_client_metadata',
      description: names.description,
    };
  }
  return { metadata: parsed.metadata, names: names.names };
}

async function persistRegistration(
  deps: ClientRegistrationDeps,
  tenant: TenantLookup,
  presentedToken: string | undefined,
  registration: ParsedRegistration,
  grant: McpPolicyGrant | null,
): Promise<ClientRegistrationOutcome> {
  return deps.withinTenant(tenant.id, async (tx) => {
    // A presented token is honoured or refused outright — never silently
    // downgraded to an anonymous registration, which would let a client
    // that got its credential wrong believe it registered with the
    // authorization it thought it had.
    let origin: ClientRecord['registrationOrigin'] = 'anonymous';
    if (presentedToken !== undefined) {
      const spent = await clientRegistrationTokenRepository(tx).spend(tenant.id, presentedToken);
      if (!spent) return { kind: 'invalid_token' };
      origin = 'token';
    }

    return performRegistration(
      deps,
      tx,
      tenant.id,
      registration.metadata,
      registration.names,
      origin,
      deps.now(),
      grant,
    );
  });
}

// The `mcp` policy: the registration endpoint open to a public client that
// can reach the tenant's MCP endpoint and nothing else (ADR 0026's amendment).
// Throttled per tenant and origin, and bounded by the tenant's `max_clients`
// like every other registration.
export async function registerMcpClient(
  deps: ClientRegistrationDeps,
  tenant: TenantLookup,
  body: unknown,
  context: RegistrationContext,
): Promise<ClientRegistrationOutcome> {
  if (deps.mcpRegistrationLimiter === undefined) return { kind: 'not_found' };
  const budget = deps.mcpRegistrationLimiter.check(tenant.id, context.origin);
  if (!budget.allowed) {
    return {
      kind: 'rate_limited',
      retryAfterSeconds: budget.retryAfterSeconds,
      scope: budget.scope ?? 'address',
    };
  }

  const registration = parseRegistration(deps, tenant, body);
  if ('kind' in registration) return registration;

  // parseClientMetadata has shown the body is an object.
  const members = body as Record<string, unknown>;
  const mcpAudience = addressUrl(context.address, MCP_RESOURCE_PATH);
  const decision = decideMcpRegistration({
    redirectUris: registration.metadata.redirectUris,
    grantTypes: registration.metadata.grantTypes,
    tokenEndpointAuthMethod: registration.metadata.tokenEndpointAuthMethod,
    scope: members.scope,
    audience: members.audience,
    mcpAudience,
    holdsKeys: registration.metadata.jwks !== null || registration.metadata.jwksUri !== null,
    hasLogoutUri:
      registration.metadata.frontchannelLogoutUri !== null ||
      registration.metadata.backchannelLogoutUri !== null,
  });
  if (decision.kind === 'invalid') {
    return { kind: 'invalid_metadata', error: decision.error, description: decision.description };
  }
  // A credential presented here is not read: spending it would store the
  // client as one an administrator authorised, which it is not.
  return persistRegistration(deps, tenant, undefined, registration, {
    audience: mcpAudience,
    granted: true,
  });
}

export async function registerClient(
  deps: ClientRegistrationDeps,
  tenantName: string,
  authorizationHeader: string | undefined,
  body: unknown,
  context: RegistrationContext,
): Promise<ClientRegistrationOutcome> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled || tenant.clientRegistrationPolicy === 'disabled') {
    return { kind: 'not_found' };
  }

  const presentedToken = extractBearerToken(authorizationHeader);
  if (tenant.clientRegistrationPolicy === 'token' && presentedToken === undefined) {
    return { kind: 'unauthorized' };
  }

  if (tenant.clientRegistrationPolicy === 'mcp') {
    return registerMcpClient(deps, tenant, body, context);
  }

  const registration = parseRegistration(deps, tenant, body);
  if ('kind' in registration) return registration;
  return persistRegistration(deps, tenant, presentedToken, registration, null);
}
