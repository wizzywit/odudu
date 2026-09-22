import { type SessionLifespans } from '@odudu/authn-flows';
import { withRealm, type DatabaseHandle } from '@odudu/db';
import { type ClaimMapperRegistry, type Clock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { corsHeadersForRequest } from '#/service/cors';
import { type ClaimContext } from '#/service/claims';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import { issueTokens, type ClientKeySet, type TokenResponse } from '#/usecase/token-issuance';
import { realmIssuerFor } from '#/view/issuer';

export interface TokenRouteDeps {
  database: DatabaseHandle;
  // Shaped like repository/realm-lookup.ts's RealmLookup, not imported from
  // it: view never reaches into repository (dependency-cruiser's
  // no-view-to-repository rule). The full lifespan pair is read here for
  // the same reason /authorize's own resolveSessions reads it — a
  // session-bound refresh dies exactly when the session it is bound to
  // would, ordinary or remembered alike (refresh-rotation.ts).
  findRealm(name: string): Promise<
    | ({
        id: string;
        enabled: boolean;
      } & SessionLifespans)
    | null
  >;
  kek: Uint8Array;
  clock: Clock;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Shared with /userinfo: the ID token's claims and a /userinfo response
  // for the same subject and scope come from the same registry, so one can
  // never carry a claim the other omits.
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  loadClaimContext(realmId: string, subjectId: string): Promise<ClaimContext>;
  // The real request's CORS decision, unlike the preflight's, is checked
  // against this one client's own expanded origins — resolved to an empty
  // set for a client_id this realm does not have, so the header is simply
  // withheld rather than turning into an error.
  resolveClientWebOrigins(realmId: string, oauthClientId: string): Promise<ReadonlySet<string>>;
  // ADR 0023's client-authentication budget, per client_id. See
  // token-issuance.ts's TokenIssuanceDeps for what it counts.
  clientSecretLimiter: ClientSecretLimiter;
  // RFC 7523 §2.2's fetcher for a client's jwks_uri — see
  // token-issuance.ts's TokenIssuanceDeps for what calls it.
  clientKeySet: ClientKeySet;
  // Gates tls_client_auth — see token-issuance.ts's TokenIssuanceDeps for
  // what reads it.
  trustProxy: boolean;
  // `ODUDU_TLS_CLIENT_CERT_HEADER` — see token-issuance.ts's
  // TokenIssuanceDeps for what reads it.
  tlsClientCertHeader: string;
}

function readClientId(body: Record<string, string | string[] | undefined>): string | undefined {
  const value = body.client_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function registerTokenRoute(app: FastifyInstance, deps: TokenRouteDeps): void {
  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/protocol/openid-connect/token', async (request, reply) => {
    const realm = await deps.findRealm(request.params.realm);
    if (!realm?.enabled) return reply.code(404).send();

    const clientId = readClientId(request.body);
    const allowedOrigins =
      clientId === undefined
        ? new Set<string>()
        : await deps.resolveClientWebOrigins(realm.id, clientId);
    const corsHeaders = corsHeadersForRequest(request.headers.origin, allowedOrigins);

    const issuer = realmIssuerFor(request, request.params.realm);

    try {
      const response: TokenResponse = await withRealm(deps.database.db, realm.id, (tx) =>
        issueTokens(
          tx,
          {
            database: deps.database,
            realmId: realm.id,
            issuer,
            kek: deps.kek,
            clock: deps.clock,
            lifespans: {
              ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
              ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
              rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
              rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
            },
            verifyPassword: deps.verifyPassword,
            clientSecretLimiter: deps.clientSecretLimiter,
            claimMappers: deps.claimMappers,
            loadClaimContext: (realmId, subjectId) => deps.loadClaimContext(realmId, subjectId),
            clientKeySet: deps.clientKeySet,
            logger: request.log,
            trustProxy: deps.trustProxy,
            tlsClientCertHeader: deps.tlsClientCertHeader,
          },
          request.body,
          request.headers.authorization,
          request.headers,
          request.raw.rawHeaders,
        ),
      );

      return await reply
        .code(200)
        .headers(corsHeaders)
        .header('cache-control', 'no-store')
        .header('pragma', 'no-cache')
        .send(response);
    } catch (err) {
      if (err instanceof TokenRateLimited) {
        // No body, the way the per-origin throttle's 429 carries none: the
        // refusal must look identical whichever client_id provoked it.
        return await reply
          .code(429)
          .headers(corsHeaders)
          .header('cache-control', 'no-store')
          .header('pragma', 'no-cache')
          .header('retry-after', String(err.retryAfterSeconds))
          .send();
      }
      if (err instanceof TokenError) {
        if (err.wwwAuthenticate !== undefined) {
          reply.header('www-authenticate', err.wwwAuthenticate);
        }
        return reply
          .code(err.status)
          .headers(corsHeaders)
          .header('cache-control', 'no-store')
          .header('pragma', 'no-cache')
          .send({ error: err.error });
      }
      throw err;
    }
  });
}
