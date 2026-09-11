import {
  advance,
  consumeAuthenticationSession,
  establishSession,
  loadPendingRequest,
  startAuthentication,
} from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { withRealm, type DatabaseHandle } from '@odudu/db';
import { verifyPassword } from '@odudu/domain-identity';
import { clientRepository } from '@odudu/domain-realm';
import { systemClock, type Clock } from '@odudu/kernel';
import { type FastifyPluginAsync } from 'fastify';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { realmLookupRepository } from '#/repository/realm-lookup';
import { issueAuthorizationCode } from '#/usecase/login-submission';
import { type ResolvedClient } from '#/usecase/authorization-request';
import { registerAuthorizeRoute } from '#/view/routes/authorize';
import { registerDiscoveryRoute } from '#/view/routes/discovery';
import { registerJwksRoute } from '#/view/routes/jwks';
import { registerLoginRoute } from '#/view/routes/login';
import { registerTokenRoute } from '#/view/routes/token';

export interface OidcRoutesDeps {
  database: DatabaseHandle;
  // The owner (RLS-bypassing) connection — see repository/realm-lookup.ts
  // for why resolving {realm} by name needs it and why that is safe.
  ownerDatabase: DatabaseHandle;
  // Unwraps the private half of the realm's active signing key so /token
  // can sign access and ID tokens. Required, not defaulted: there is no
  // safe placeholder for a key-encryption key.
  kek: Uint8Array;
  // Whether this process serves over TLS — picks the session cookie's
  // __Host- prefix and Secure attribute. Defaults off, matching the compose
  // stack's plain-HTTP local loop.
  tls?: boolean;
  // Injected so a test can advance time and have the authentication
  // session started by /authorize and the one read back by the login
  // handler agree on "now". Defaults to the real clock.
  clock?: Clock;
}

// The plugin apps/server registers. Discovery never queries the resolved
// realm's own tenant data (constants plus the resolved issuer); JWKS reads
// through signingKeyRepository once realm context is established for the
// resolved realm id.
export function oidcRoutes(deps: OidcRoutesDeps): FastifyPluginAsync {
  return (app) => {
    const findRealm = (name: string) => realmLookupRepository(deps.ownerDatabase.db).byName(name);
    const clock = deps.clock ?? systemClock;
    const tls = deps.tls ?? false;

    registerDiscoveryRoute(app, { findRealm });
    registerJwksRoute(app, {
      findRealm,
      listPublishableKeys: (realmId) =>
        withRealm(deps.database.db, realmId, (tx) => signingKeyRepository(tx).listPublishable()),
    });
    registerAuthorizeRoute(app, {
      findRealm,
      resolveClient: (realmId, oauthClientId) =>
        withRealm(deps.database.db, realmId, async (tx): Promise<ResolvedClient> => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (client === null) return { client: null, config: null };
          const config = await clientOidcConfigRepository(tx).byClientId(client.id);
          return { client, config };
        }),
      startAuthentication: (realmId, request) =>
        withRealm(deps.database.db, realmId, (tx) =>
          startAuthentication(tx, realmId, request, clock),
        ),
    });
    registerLoginRoute(app, {
      findRealm,
      tls,
      advance: (realmId, authSessionId, input) =>
        withRealm(deps.database.db, realmId, (tx) => advance(tx, authSessionId, input, clock)),
      loadPendingRequest: (realmId, authSessionId) =>
        withRealm(deps.database.db, realmId, (tx) => loadPendingRequest(tx, authSessionId)),
      resolveClientId: (realmId, oauthClientId) =>
        withRealm(deps.database.db, realmId, async (tx) => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          return client === null ? null : client.id;
        }),
      // One transaction: the conditional consume, and — only if it actually
      // consumed the session — establishing the SSO session and issuing the
      // code. A failure anywhere in here rolls all three back together,
      // so it never leaves a consumed session with nothing issued for it.
      completeLogin: (input) =>
        withRealm(deps.database.db, input.realmId, async (tx) => {
          const now = clock.now();
          const consumed = await consumeAuthenticationSession(tx, input.authSessionId, clock);
          if (!consumed) return { kind: 'already_consumed' };

          const { sessionId } = await establishSession(tx, input.realmId, input.subjectId, clock);
          // authTime and expiresAt both derive from this single `now`, not a
          // fresh clock read inside issueAuthorizationCode — otherwise two
          // reads straddling a millisecond boundary could store a TTL
          // slightly over 60s.
          const { code } = await issueAuthorizationCode(tx, {
            realmId: input.realmId,
            clientId: input.clientId,
            subjectId: input.subjectId,
            redirectUri: input.redirectUri,
            scope: input.scope,
            nonce: input.nonce,
            codeChallenge: input.codeChallenge,
            codeChallengeMethod: input.codeChallengeMethod,
            authTime: now,
          });
          return { kind: 'issued', sessionId, code };
        }),
    });
    registerTokenRoute(app, {
      database: deps.database,
      findRealm,
      kek: deps.kek,
      clock,
      verifyPassword,
    });

    return Promise.resolve();
  };
}

export { clientOidcConfigRepository } from '#/repository/client-oidc-config';
export { type ClientOidcConfig } from '#/schema/client-oidc-config';
export { realmLookupRepository, type RealmLookup } from '#/repository/realm-lookup';
