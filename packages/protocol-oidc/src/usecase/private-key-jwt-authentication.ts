import { verifyJwtAgainstJwkSet } from '@odudu/crypto';
import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { type AuditReason } from '@odudu/domain-audit';
import { clientRepository, type ClientRecord } from '@odudu/domain-tenant';
import { tlsClientAuthSubjectMatches, tlsClientSubject } from '#/service/tls-client-auth';
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
export interface EndpointAuthenticationDeps extends PrivateKeyJwtDeps {
  readonly issuer: string;
  // Gates tls_client_auth exactly as it gates Fastify's own `X-Forwarded-*`
  // trust: the proxy-supplied subject header is as forgeable as those, so it
  // is read only when an operator has said a proxy in front controls it.
  readonly trustProxy: boolean;
  // `ODUDU_TLS_CLIENT_CERT_HEADER`: no two proxies agree on a name.
  readonly tlsClientCertHeader: string;
}

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
): Promise<AuthenticatedClient> {
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

  const jtis = assertionJtiRepository(deps.database);
  const { claimedClientId: oauthClientId, jti, expiresAt } = outcome;
  // Never waited for: whoever holds this lock is mid-way through using this
  // very assertion, which makes this one a replay whatever becomes of that use.
  if (!(await jtis.tryLock(tx, deps.tenantId, oauthClientId, jti))) {
    return fail('jti is being used by another request', { client, reason: 'replayed' });
  }
  if (await jtis.spentWithin(tx, deps.tenantId, oauthClientId, jti)) {
    return fail('jti already spent', { client, reason: 'replayed' });
  }

  // Spent when the request's work is done, on its own transaction; spent on a
  // connection of its own, before that transaction lets go of the lock, if the
  // work fails, so no replay can slip between the rollback and the spending.
  const settle: Settle = async (work) => {
    try {
      const result = await work();
      await jtis.claimWithin(tx, deps.tenantId, oauthClientId, jti, expiresAt);
      return result;
    } catch (err) {
      await spendQuietly(deps, { tenantId: deps.tenantId, oauthClientId, jti, expiresAt });
      throw err;
    }
  };
  return { client, config, settle };
}

// Shares `refusePrivateKeyJwt`'s shape (same log message pattern, same
// single invalid_client) rather than its function: the two methods refuse
// for entirely different reasons, and folding them into one function would
// make a future change to one method's logging silently change the
// other's too.
export function refuseTlsClientAuth(
  deps: PrivateKeyJwtDeps,
  reason: string,
  claimedClientId?: string,
  client?: ClientRecord,
): never {
  deps.logger.warn(
    { reason, ...(claimedClientId !== undefined ? { claimedClientId } : {}) },
    'tls_client_auth authentication refused',
  );
  throw refusedAuthentication(
    'tls_client_auth',
    client === undefined ? undefined : { client, reason: 'bad_credential' },
  );
}

// RFC 8705 §2.1's PKI mutual-TLS method, proxy-terminated
// (`tls-client-auth.ts` has the deployment shape). Seven preconditions,
// each checked here explicitly rather than assumed: a client_id was
// presented, the client is known, enabled, confidential, registered for
// this method, a registered subject exists, and it matches. `enabled` in
// particular is checked directly rather than inherited from a callee —
// nothing here may assume a property of the client that some other
// function established.
async function authenticateTlsClientAuth(
  tx: TenantScopedDatabase,
  deps: PrivateKeyJwtDeps,
  certificateSubject: string,
  claimedClientId: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  if (claimedClientId === undefined) {
    return refuseTlsClientAuth(deps, 'no client_id presented alongside the certificate');
  }

  const client = await clientRepository(tx).byClientId(claimedClientId);
  if (client === null) return refuseTlsClientAuth(deps, 'unknown client', claimedClientId);
  if (!client.enabled)
    return refuseTlsClientAuth(deps, 'client is disabled', claimedClientId, client);
  // tls_client_auth is a confidential-client method — checked again here
  // rather than trusted from registration. The only confidentiality check
  // on this path: `evaluateClientCredentialsGrant` also refuses a public
  // client, but only for the client_credentials grant it belongs to —
  // authorization_code and refresh_token have no such downstream check, so
  // for those grants this is the only thing standing between a public
  // client and a token.
  if (client.type !== 'confidential') {
    return refuseTlsClientAuth(deps, 'client is not confidential', claimedClientId, client);
  }

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  // client-metadata.ts's `parseClientMetadata` stores
  // `tlsClientAuthSubjectDn` only for a client registered `tls_client_auth`
  // — a client of any other method always reaches this with `config`
  // either absent or carrying a null subject, so skipping this check
  // would still 401 there, at the null-subject check below, just with a
  // less specific reason logged. True only because that storage rule
  // holds; checked directly anyway, not trusted.
  if (config?.tokenEndpointAuthMethod !== 'tls_client_auth') {
    return refuseTlsClientAuth(
      deps,
      'client is not registered for tls_client_auth',
      claimedClientId,
      client,
    );
  }
  // Unreachable only because the check immediately above already pinned
  // `tokenEndpointAuthMethod === 'tls_client_auth'`, and
  // client_oidc_config_tls_client_auth_needs_subject_dn (migration
  // 0055_client_tls_client_auth_subject_dn.sql) guarantees a non-null
  // subject for exactly that method — the constraint alone does not, since
  // it says nothing about any other method. Checked anyway, the same
  // defense the client_credentials path takes on `serviceSubjectId` above.
  if (config.tlsClientAuthSubjectDn === null) {
    return refuseTlsClientAuth(
      deps,
      'client has no registered certificate subject',
      claimedClientId,
      client,
    );
  }
  if (!tlsClientAuthSubjectMatches(certificateSubject, config.tlsClientAuthSubjectDn)) {
    return refuseTlsClientAuth(
      deps,
      'certificate subject does not match the registered value',
      claimedClientId,
      client,
    );
  }

  return { client, config };
}

export interface SpentAssertion {
  readonly tenantId: string;
  readonly oauthClientId: string;
  readonly jti: string;
  readonly expiresAt: Date;
}

// How long a failing request waits for a connection to spend its jti on before
// it gives up and logs: the pool being exhausted is the one case it cannot spend.
const SPEND_PATIENCE_MS = 2000;

// Never throws and never delays the refusal it follows by more than the
// patience above: an error here must not turn a refused request into a 500.
async function spendQuietly(deps: PrivateKeyJwtDeps, spent: SpentAssertion): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      assertionJtiRepository(deps.database).claim(
        spent.tenantId,
        spent.oauthClientId,
        spent.jti,
        spent.expiresAt,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SPEND_PATIENCE_MS);
      }),
    ]);
  } catch (err) {
    deps.logger.warn(
      {
        claimedClientId: spent.oauthClientId,
        error: err instanceof Error ? err.message : 'unknown',
      },
      'an assertion jti could not be spent after a refused request',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Runs what a request does once authenticated, and spends its assertion's jti either way. */
export type Settle = <T>(work: () => Promise<T>) => Promise<T>;

export interface AuthenticatedClient {
  readonly client: ClientRecord;
  readonly config: ClientOidcConfig;
  readonly settle: Settle;
}

const NOTHING_TO_SETTLE: Settle = (work) => work();

export interface ClientRequest {
  readonly body: Record<string, string | string[] | undefined>;
  readonly authorizationHeader: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
  // Node's own `IncomingMessage.rawHeaders`, which alone can tell a header
  // sent twice from one value holding a comma.
  readonly rawHeaders: readonly string[];
}

/**
 * Client authentication for every endpoint that authenticates one — /token,
 * /revoke and /introspect: a private_key_jwt assertion, a certificate subject
 * a trusted proxy supplies (tls_client_auth), or the Basic and body-secret
 * methods `authenticateClient` answers. A client presents exactly one
 * (RFC 6749 §2.3), and a presentation of two is refused before either runs.
 */
export async function authenticateEndpointClient(
  tx: TenantScopedDatabase,
  deps: EndpointAuthenticationDeps,
  request: ClientRequest,
): Promise<AuthenticatedClient> {
  const { body } = request;
  const tokenEndpoint = tokenEndpointOf(deps.issuer);
  const assertion = parseClientAssertion(body, deps.now(), { audience: tokenEndpoint });
  const basic = parseBasicAuth(request.authorizationHeader);
  const bodyClientSecret = readOptionalField(body, 'client_secret');
  const certResult = tlsClientSubject(request.headers, request.rawHeaders, {
    trustProxy: deps.trustProxy,
    headerName: deps.tlsClientCertHeader,
  });
  // A duplicated header is refused outright, never downgraded to "no
  // certificate presented", which would leave an operator debugging a
  // completely unexplained 401.
  if (certResult.kind === 'duplicated') {
    refuseTlsClientAuth(deps, 'certificate subject header presented more than once');
  }
  const certificateSubject = certResult.kind === 'present' ? certResult.subject : null;

  if (
    certificateSubject !== null &&
    (assertion.kind !== 'unsupported' || basic !== undefined || bodyClientSecret !== undefined)
  ) {
    refuseTlsClientAuth(deps, 'certificate presented alongside another authentication method');
  }
  if (assertion.kind !== 'unsupported' && (basic !== undefined || bodyClientSecret !== undefined)) {
    refusePrivateKeyJwt(
      deps,
      'assertion presented alongside a client_secret',
      assertion.kind === 'ok' ? assertion.claimedClientId : undefined,
    );
  }

  const clientId = readOptionalField(body, 'client_id');
  if (assertion.kind !== 'unsupported') {
    // RFC 7521 §4.2: a client_id sent beside an assertion identifies the same
    // client the assertion's subject does.
    if (
      assertion.kind === 'ok' &&
      clientId !== undefined &&
      clientId !== assertion.claimedClientId
    ) {
      refusePrivateKeyJwt(
        deps,
        'client_id does not match the assertion',
        assertion.claimedClientId,
      );
    }
    return authenticatePrivateKeyJwt(tx, deps, assertion, tokenEndpoint);
  }
  const authenticated =
    certificateSubject !== null
      ? await authenticateTlsClientAuth(tx, deps, certificateSubject, clientId)
      : await authenticateClient(tx, deps, basic, clientId, bodyClientSecret);
  return { ...authenticated, settle: NOTHING_TO_SETTLE };
}
