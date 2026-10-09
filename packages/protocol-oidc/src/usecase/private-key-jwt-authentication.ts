import { verifyJwtAgainstJwkSet } from '@odudu/crypto';
import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { type AuditReason } from '@odudu/domain-audit';
import { clientRepository, type ClientRecord } from '@odudu/domain-tenant';
import { assertionJtiRepository } from '#/repository/assertion-jti';
import { type ClientKeySet } from '#/repository/client-keys';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { parseClientAssertion, type AssertionOutcome } from '#/service/client-assertion';
import { invalidClient, withAudit, type TokenError } from '#/service/errors';
import {
  authenticateClient,
  parseBasicAuth,
  readOptionalField,
  WWW_AUTHENTICATE,
  type ClientAuthenticationDeps,
} from '#/usecase/client-authentication';

export interface PrivateKeyJwtDeps extends ClientAuthenticationDeps {
  // The pool handle, not the request's `tx`: a jti is claimed in a
  // transaction of its own so a rollback of the request cannot release it.
  readonly database: DatabaseHandle;
  readonly clientKeySet: ClientKeySet;
}

/**
 * The one audience an assertion may name, at every endpoint a client
 * authenticates to: the tenant's token endpoint, the string discovery
 * publishes as `token_endpoint`. OIDC Core §9 asks for it, and one value
 * leaves nothing to choose between at /revoke and /introspect.
 */
export function tokenEndpointOf(issuer: string): string {
  return `${issuer}/protocol/openid-connect/token`;
}

// `claimedClientId`, not `clientId`: nothing here is verified until a
// signature check passes, so the log names it for what it is — the
// assertion's own say-so — the same distinction `client-assertion.ts` draws
// in `AssertionOutcome`'s own doc comment. Shared by `authenticatePrivateKeyJwt`
// below and `issueTokens`'s own both-methods-presented refusal, so that
// refusal — upstream of the eight branches below and not one of them — logs
// a reason too, instead of being the one assertion refusal that doesn't.
export function refusePrivateKeyJwt(
  deps: PrivateKeyJwtDeps,
  reason: string,
  claimedClientId?: string,
  resolved?: { client: ClientRecord; reason: AuditReason },
): never {
  deps.logger.warn(
    { reason, ...(claimedClientId !== undefined ? { claimedClientId } : {}) },
    'private_key_jwt authentication refused',
  );
  throw refusedAuthentication('private_key_jwt', resolved);
}

// A refusal is recorded only once the claimed client resolved to a
// registered one; before that it names nobody (ADR 0037).
export function refusedAuthentication(
  method: string,
  resolved: { client: ClientRecord; reason: AuditReason } | undefined,
): TokenError {
  const refusal = invalidClient(WWW_AUTHENTICATE);
  if (resolved === undefined) return refusal;
  return withAudit(refusal, {
    action: 'client.authenticate',
    reason: resolved.reason,
    clientDbId: resolved.client.id,
    method,
  });
}

// RFC 7523 §2.2 / OIDC Core §9's `private_key_jwt`. Every failure reports
// the same `invalid_client`, verification runs before the jti is ever
// claimed, and the timing residual that leaves open is stated rather than
// hidden — see docs/protocols/rfc7523.md's reading notes for why each of
// those holds. The specific reason goes to `deps.logger`; only an operator
// reads it.
export async function authenticatePrivateKeyJwt(
  tx: TenantScopedDatabase,
  deps: PrivateKeyJwtDeps,
  outcome: Exclude<AssertionOutcome, { kind: 'unsupported' }>,
  tokenEndpoint: string,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  const fail = (reason: string, resolved?: { client: ClientRecord; reason: AuditReason }): never =>
    refusePrivateKeyJwt(
      deps,
      reason,
      outcome.kind === 'ok' ? outcome.claimedClientId : undefined,
      resolved,
    );

  if (outcome.kind !== 'ok') return fail('assertion failed structural validation');

  const client = await clientRepository(tx).byClientId(outcome.claimedClientId);
  if (client === null) return fail('unknown client');
  const badCredential = { client, reason: 'bad_credential' } as const;
  // `authenticateClient`'s password path gets this only incidentally, inside
  // `verifyClientSecret` (packages/domain-tenant/src/service/client.ts) —
  // this path calls no such function, so a disabled client must be refused
  // here explicitly or the operator's one revocation lever does nothing to
  // a private_key_jwt client.
  if (!client.enabled) return fail('client is disabled', badCredential);

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  if (config?.tokenEndpointAuthMethod !== 'private_key_jwt') {
    return fail('client is not registered for private_key_jwt', badCredential);
  }

  let jwks: unknown;
  if (config.jwks !== null) {
    jwks = config.jwks;
  } else if (config.jwksUri !== null) {
    try {
      jwks = await deps.clientKeySet.fetch(config.jwksUri, deps.tenantId);
    } catch (err) {
      // A fetch that fails is this server failing to reach the client's
      // keys, not the client failing to authenticate, so it writes no row.
      return fail(err instanceof Error ? err.message : 'jwks_uri fetch failed');
    }
  } else {
    return fail('client publishes no keys', badCredential);
  }

  const verified = await verifyJwtAgainstJwkSet(outcome.assertion, jwks, {
    issuer: outcome.claimedClientId,
    audience: tokenEndpoint,
    now: deps.now(),
  });
  if (!verified) return fail('assertion signature did not verify', badCredential);

  const claimed = await assertionJtiRepository(deps.database).claim(
    deps.tenantId,
    outcome.claimedClientId,
    outcome.jti,
    outcome.expiresAt,
  );
  if (!claimed) return fail('jti already spent', { client, reason: 'replayed' });

  return { client, config };
}

/**
 * Client authentication for the endpoints that take no grant — /revoke and
 * /introspect: an assertion, or the Basic and body-secret methods
 * `authenticateClient` already answers. Presenting both is refused, as at
 * /token (RFC 6749 §2.3).
 */
export async function authenticateEndpointClient(
  tx: TenantScopedDatabase,
  deps: PrivateKeyJwtDeps & { readonly issuer: string },
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  const tokenEndpoint = tokenEndpointOf(deps.issuer);
  const assertion = parseClientAssertion(body, deps.now(), { audience: tokenEndpoint });
  const basic = parseBasicAuth(authorizationHeader);
  const bodyClientSecret = readOptionalField(body, 'client_secret');
  if (assertion.kind === 'unsupported') {
    return authenticateClient(
      tx,
      deps,
      basic,
      readOptionalField(body, 'client_id'),
      bodyClientSecret,
    );
  }
  if (basic !== undefined || bodyClientSecret !== undefined) {
    refusePrivateKeyJwt(
      deps,
      'assertion presented alongside a client_secret',
      assertion.kind === 'ok' ? assertion.claimedClientId : undefined,
    );
  }
  return authenticatePrivateKeyJwt(tx, deps, assertion, tokenEndpoint);
}
