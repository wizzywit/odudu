import { type RealmScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clientRepository,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { randomBytes } from 'node:crypto';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { type RealmLookup } from '#/repository/realm-lookup';
import { extractBearerToken } from '#/service/bearer-token';
import { parseClientMetadata, type ClientMetadata } from '#/service/client-metadata';

export interface ClientRegistrationDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // Everything past realm resolution runs inside one realm-scoped
  // transaction: spending the token, taking the cap under its lock, and
  // the two inserts. A failure anywhere rolls all of it back together.
  withinRealm<T>(realmId: string, fn: (tx: RealmScopedDatabase) => Promise<T>): Promise<T>;
  hashClientSecret(secret: string): Promise<string>;
  now(): Date;
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
// (packages/domain-realm/src/repository/client-registration-tokens.ts) —
// 256 bits of entropy, comfortably above what a bearer credential needs.
function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

function clientType(tokenEndpointAuthMethod: string): 'public' | 'confidential' {
  return tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
}

// One transaction, entered only once the realm is known to accept
// registrations at all — a disabled realm and an unknown one both stop at
// `not_found` before any transaction opens.
async function performRegistration(
  deps: ClientRegistrationDeps,
  tx: RealmScopedDatabase,
  realmId: string,
  metadata: ClientMetadata,
  origin: ClientRecord['registrationOrigin'],
  now: Date,
): Promise<ClientRegistrationOutcome> {
  const capacity = await clientRepository(tx).lockCapacity(realmId);
  if (capacity.count >= capacity.maxClients) {
    return { kind: 'at_capacity' };
  }

  // jwks_uri is validated for shape only, by parseClientMetadata
  // (assertFetchableUrl) — never dereferenced here. The key is not needed
  // until `authenticatePrivateKeyJwt` (usecase/token-issuance.ts) fetches
  // it at request time; dereferencing at registration would make a
  // registration's success depend on a socket to a host the registrant
  // does not control being up at that instant, and never again — the
  // opposite of what a registration is for. See docs/NEXT.md.
  const type = clientType(metadata.tokenEndpointAuthMethod);

  let serviceSubjectId: string | null = null;
  if (type === 'confidential') {
    const serviceSubject = await subjectRepository(tx).create({ realmId, type: 'service' });
    serviceSubjectId = serviceSubject.id;
  }

  const clientSecret = type === 'confidential' ? generateClientSecret() : null;
  const secretHash = clientSecret === null ? null : await deps.hashClientSecret(clientSecret);

  const oauthClientId = newId();
  const client = await clientRepository(tx).create({
    realmId,
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
    realmId,
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
  realmName: string,
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ClientRegistrationOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled || realm.clientRegistrationPolicy === 'disabled') {
    return { kind: 'not_found' };
  }

  const presentedToken = extractBearerToken(authorizationHeader);
  if (realm.clientRegistrationPolicy === 'token' && presentedToken === undefined) {
    return { kind: 'unauthorized' };
  }

  const parsed = parseClientMetadata(body);
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid_metadata', error: parsed.error, description: parsed.description };
  }

  return deps.withinRealm(realm.id, async (tx) => {
    // A presented token is honoured or refused outright — never silently
    // downgraded to an anonymous registration, which would let a client
    // that got its credential wrong believe it registered with the
    // authorization it thought it had.
    let origin: ClientRecord['registrationOrigin'] = 'anonymous';
    if (presentedToken !== undefined) {
      const spent = await clientRegistrationTokenRepository(tx).spend(realm.id, presentedToken);
      if (!spent) return { kind: 'invalid_token' };
      origin = 'token';
    }

    return performRegistration(deps, tx, realm.id, parsed.metadata, origin, deps.now());
  });
}
