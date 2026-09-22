import { signingKeyRepository } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clientRepository,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { randomBytes } from 'node:crypto';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { extractBearerToken } from '#/service/bearer-token';
import { parseClientMetadata, type ClientMetadata } from '#/service/client-metadata';

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
}

export interface RegisteredClient {
  clientId: string;
  clientIdIssuedAt: number;
  clientSecret: string | null;
  metadata: ClientMetadata;
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
  origin: ClientRecord['registrationOrigin'],
  now: Date,
): Promise<ClientRegistrationOutcome> {
  const capacity = await clientRepository(tx).lockCapacity(tenantId);
  if (capacity.count >= capacity.maxClients) {
    return { kind: 'at_capacity' };
  }

  // Checked in the same transaction the tenant's key lives in, so discovery
  // and registration cannot disagree; `null` (no active key) is a mismatch too.
  if (
    metadata.userinfoSignedResponseAlg !== null &&
    metadata.userinfoSignedResponseAlg !== 'none'
  ) {
    const activeAlg: string | null = await signingKeyRepository(tx)
      .active()
      .then(
        (key) => key.alg,
        () => null,
      );
    if (activeAlg !== metadata.userinfoSignedResponseAlg) {
      return {
        kind: 'invalid_metadata',
        error: 'invalid_client_metadata',
        description: `userinfo_signed_response_alg ${metadata.userinfoSignedResponseAlg} does not match this tenant's active signing key (${activeAlg ?? 'none'})`,
      };
    }
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
    type,
    secretHash,
    serviceSubjectId,
    registrationOrigin: origin,
  });

  await provisionClientDefaults(tx, client.id);

  await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
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
    consentRequired: origin === 'anonymous',
    userinfoSignedResponseAlg: metadata.userinfoSignedResponseAlg,
    userinfoEncryptedResponseAlg: metadata.userinfoEncryptedResponseAlg,
    userinfoEncryptedResponseEnc: metadata.userinfoEncryptedResponseEnc,
    tlsClientAuthSubjectDn: metadata.tlsClientAuthSubjectDn,
  });

  return {
    kind: 'ok',
    client: {
      clientId: oauthClientId,
      clientIdIssuedAt: Math.floor(now.getTime() / 1000),
      clientSecret,
      metadata,
    },
  };
}

export async function registerClient(
  deps: ClientRegistrationDeps,
  tenantName: string,
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ClientRegistrationOutcome> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled || tenant.clientRegistrationPolicy === 'disabled') {
    return { kind: 'not_found' };
  }

  const presentedToken = extractBearerToken(authorizationHeader);
  if (tenant.clientRegistrationPolicy === 'token' && presentedToken === undefined) {
    return { kind: 'unauthorized' };
  }

  const parsed = parseClientMetadata(body, { tlsClientAuthEnabled: deps.tlsClientAuthEnabled });
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid_metadata', error: parsed.error, description: parsed.description };
  }

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

    return performRegistration(deps, tx, tenant.id, parsed.metadata, origin, deps.now());
  });
}
