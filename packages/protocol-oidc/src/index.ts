import {
  advance,
  authenticationSessionRepository,
  beginPasskeyAuthentication,
  beginPasskeyEnrolment,
  beginTotpEnrolment,
  completePasskeyEnrolment,
  completeTotpEnrolment,
  consumeAuthenticationSession,
  establishSession,
  initialChallenge,
  loadPendingRequest,
  pendingChallenge,
  requiredActionRepository,
  resetAuthenticationProgress,
  sessionRepository,
  startAuthentication,
} from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { effectiveGroupPaths, effectiveRoles } from '@odudu/domain-authz';
import { withRealm, type DatabaseHandle } from '@odudu/db';
import { userRepository, verifyPassword } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository } from '@odudu/domain-realm';
import { isUuid, systemClock, type Clock } from '@odudu/kernel';
import { type FastifyPluginAsync } from 'fastify';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { realmLookupRepository } from '#/repository/realm-lookup';
import { reachableRoleIds } from '#/repository/scope-role-reach';
import { standardClaimMappers } from '#/service/claims';
import { expandWebOrigins } from '#/service/web-origin';
import { issueAuthorizationCode } from '#/usecase/login-submission';
import { type ResolvedClient } from '#/usecase/authorization-request';
import { registerAuthorizeRoute } from '#/view/routes/authorize';
import { registerCors } from '#/view/routes/cors';
import { registerDiscoveryRoute } from '#/view/routes/discovery';
import { registerJwksRoute } from '#/view/routes/jwks';
import { registerLoginRoute } from '#/view/routes/login';
import { registerRequiredActionRoute } from '#/view/routes/required-action';
import { registerLogoutRoute } from '#/view/routes/logout';
import { registerTokenRoute } from '#/view/routes/token';
import { registerUserinfoRoute } from '#/view/routes/userinfo';

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
  // Where this deployment is published, and the only thing a WebAuthn
  // relying party id is derived from — never a request header, which the
  // client controls. Undefined when ODUDU_PUBLIC_BASE_URL is unset, and
  // passkey enrolment then reports itself unsupported rather than binding
  // credentials to a guessed domain.
  publicBaseUrl?: string;
}

// The plugin apps/server registers. Discovery and JWKS both read the
// resolved realm's own tenant data — its scope vocabulary and its
// publishable keys — once realm context is established for the resolved
// realm id.
export function oidcRoutes(deps: OidcRoutesDeps): FastifyPluginAsync {
  return (app) => {
    const findRealm = (name: string) => realmLookupRepository(deps.ownerDatabase.db).byName(name);
    const clock = deps.clock ?? systemClock;
    const tls = deps.tls ?? false;
    // One registry per process, shared by discovery (claimNames, for
    // claims_supported), /userinfo, and token issuance's ID token claims —
    // so a mapper registered once reaches every consumer the same way.
    const claimMappers = standardClaimMappers();
    // Roles need a recursive CTE (effectiveRoles), which a claim mapper must
    // never run itself — resolved here, once per issuance, alongside the
    // user row and the subject's direct group memberships, and handed to
    // the mappers as data.
    const loadClaimContext = (realmId: string, subjectId: string) =>
      withRealm(deps.database.db, realmId, async (tx) => ({
        subjectId,
        user: await userRepository(tx).bySubjectId(subjectId),
        roles: await effectiveRoles(tx, subjectId),
        groups: await effectiveGroupPaths(tx, subjectId),
      }));

    // The keys /jwks publishes, and the ones an `id_token_hint` is checked
    // against at /authorize — one definition, so a client trusting the
    // published set and this server judging a hint cannot disagree.
    const listPublishableKeys = (realmId: string) =>
      withRealm(deps.database.db, realmId, (tx) => signingKeyRepository(tx).listPublishable());

    // /userinfo's own gate on the `roles` claim: which role ids the token's
    // granted scope reaches, and whether its client bypasses that
    // intersection — the same two facts token issuance reads from the same
    // tables, so a role withheld from the token cannot resurface here.
    const resolveRoleReach = (realmId: string, oauthClientId: string, scope: readonly string[]) =>
      withRealm(deps.database.db, realmId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        return {
          reachableRoleIds: await reachableRoleIds(tx, scope),
          fullScopeAllowed: client?.fullScopeAllowed ?? false,
        };
      });

    // Shared by /token and /userinfo: once each has resolved which client
    // the request is for, this is the same lookup either way — an unknown
    // or foreign client_id resolves to an empty set, so the caller withholds
    // the header instead of treating it as an error.
    const resolveClientWebOrigins = (realmId: string, oauthClientId: string) =>
      withRealm(deps.database.db, realmId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        // A disabled client's origin must stop working the same way a
        // disabled client's tokens do — the CORS allowlist is not a second,
        // forgotten door into a client that was disabled for a reason.
        if (!client?.enabled) return new Set<string>();
        const config = await clientOidcConfigRepository(tx).byClientId(client.id);
        if (config === null) return new Set<string>();
        return expandWebOrigins(config.webOrigins, config.redirectUris);
      });

    // One definition, read by discovery for scopes_supported and by
    // /authorize for what it will accept, so the advertised list and the
    // accepted one cannot drift apart.
    const scopesForRealm = (realmId: string): Promise<readonly string[]> =>
      withRealm(deps.database.db, realmId, async (tx) =>
        (await clientScopeRepository(tx).allForRealm()).map((scope) => scope.name),
      );

    // The one definition of "is this subject's address verified", read by
    // both doors into completing a login: the password form and a reused
    // SSO session cookie.
    const checkEmailVerification = (realmId: string, subjectId: string) =>
      withRealm(deps.database.db, realmId, async (tx) => {
        const user = await userRepository(tx).bySubjectId(subjectId);
        return {
          verified: user?.emailVerified ?? false,
          hasEmail: (user?.email ?? null) !== null,
        };
      });

    // Whether the login page offers a passkey button at all: the relying
    // party id comes from ODUDU_PUBLIC_BASE_URL and nowhere else, so
    // without it there is nothing behind one.
    const passkeyLogin = { passkeyLogin: deps.publicBaseUrl !== undefined };

    registerDiscoveryRoute(app, {
      findRealm,
      claimNames: () => claimMappers.claimNames(),
      scopesForRealm,
    });
    registerJwksRoute(app, { findRealm, listPublishableKeys });
    registerAuthorizeRoute(app, {
      findRealm,
      tls,
      ...passkeyLogin,
      listPublishableKeys,
      scopesForRealm,
      resolveClient: (realmId, oauthClientId) =>
        withRealm(deps.database.db, realmId, async (tx): Promise<ResolvedClient> => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (client === null) return { client: null, config: null, scopes: [] };
          const config = await clientOidcConfigRepository(tx).byClientId(client.id);
          const assigned = await clientScopeRepository(tx).forClient(client.id);
          return { client, config, scopes: assigned.map((scope) => scope.name) };
        }),
      startAuthentication: (realmId, request) =>
        withRealm(deps.database.db, realmId, (tx) =>
          startAuthentication(tx, realmId, request, clock),
        ),
      initialChallenge: (realmId) =>
        withRealm(deps.database.db, realmId, (tx) => initialChallenge(tx, realmId)),
      now: () => clock.now(),
      // The realm's idle window comes from the `realm` the caller already
      // resolved (its own `findRealm`), not a second lookup by id.
      resolveSession: async (realm, cookieValue) => {
        // The cookie is trusted for nothing but this lookup, and a session
        // id is a UUID column — a value shaped like anything else names no
        // row rather than raising the invalid-input-syntax error Postgres
        // would give a raw comparison.
        if (cookieValue === undefined || !isUuid(cookieValue)) return null;
        return withRealm(deps.database.db, realm.id, async (tx) => {
          const record = await sessionRepository(tx).liveById(
            cookieValue,
            realm.ssoSessionIdleSeconds,
            clock.now(),
          );
          if (record === null) return null;
          return { sessionId: record.id, subjectId: record.subjectId, authTime: record.createdAt };
        });
      },
      checkEmailVerification,
      // Touch and issue in one transaction: a reused session is a session
      // being used, and there is no reason for the two writes this makes to
      // land in separate ones.
      completeReuse: (input) =>
        withRealm(deps.database.db, input.realmId, async (tx) => {
          const now = clock.now();
          await sessionRepository(tx).touch(input.sessionId, now);
          // `now`, not `input.authTime`: the code's 60s TTL counts from this
          // issuance, however long ago the session's own login was.
          return issueAuthorizationCode(tx, {
            realmId: input.realmId,
            clientId: input.clientId,
            subjectId: input.subjectId,
            redirectUri: input.redirectUri,
            scope: input.scope,
            nonce: input.nonce,
            codeChallenge: input.codeChallenge,
            codeChallengeMethod: input.codeChallengeMethod,
            authTime: input.authTime,
            now,
            sessionId: input.sessionId,
          });
        }),
    });
    // One definition for both doors onto the enrolment page: the login
    // submission that discovers the action is owed, and the enrolment
    // submission that has to re-render it after a wrong code.
    const startTotpEnrolment = (realmName: string, realmId: string, subjectId: string) =>
      withRealm(deps.database.db, realmId, (tx) => beginTotpEnrolment(tx, realmName, subjectId));

    // Both halves of passkey enrolment exist only where a relying party can
    // be derived; where it cannot, the routes have nothing to call and say
    // so, rather than naming a domain nobody configured.
    const publicBaseUrl = deps.publicBaseUrl;
    const passkeyEnrolment =
      publicBaseUrl === undefined
        ? {}
        : {
            beginPasskeyEnrolment: (
              realmName: string,
              realmId: string,
              subjectId: string,
              authSessionId: string,
            ) =>
              withRealm(deps.database.db, realmId, (tx) =>
                beginPasskeyEnrolment(tx, {
                  realmName,
                  publicBaseUrl,
                  authSessionId,
                  subjectId,
                }),
              ),
          };
    // The endpoint the passkey button calls for its options.
    const passkeyAssertion =
      publicBaseUrl === undefined
        ? {}
        : {
            beginPasskeyAuthentication: (realmId: string, authSessionId: string) =>
              withRealm(deps.database.db, realmId, (tx) =>
                beginPasskeyAuthentication(tx, { publicBaseUrl, authSessionId }),
              ),
          };

    const passkeySubmission =
      publicBaseUrl === undefined
        ? {}
        : {
            completePasskeyEnrolment: (input: {
              realmId: string;
              subjectId: string;
              authSessionId: string;
              response: unknown;
              label?: string;
            }) =>
              withRealm(deps.database.db, input.realmId, (tx) =>
                completePasskeyEnrolment(tx, { ...input, publicBaseUrl }),
              ),
          };

    const pendingChallengeFor = (realmId: string, authSessionId: string) =>
      withRealm(deps.database.db, realmId, (tx) => pendingChallenge(tx, authSessionId, clock));

    // One definition for both readers: the login gate that discovers an
    // action is owed, and the required-action route that will not act on
    // one that is not.
    const pendingActions = (realmId: string, subjectId: string) =>
      withRealm(deps.database.db, realmId, (tx) =>
        requiredActionRepository(tx).pendingFor(subjectId),
      );

    registerRequiredActionRoute(app, {
      findRealm,
      ...passkeyLogin,
      beginTotpEnrolment: startTotpEnrolment,
      ...passkeyEnrolment,
      ...passkeySubmission,
      pendingChallenge: pendingChallengeFor,
      pendingActions,
      boundSubject: (realmId, authSessionId) =>
        withRealm(deps.database.db, realmId, async (tx) => {
          const record = await authenticationSessionRepository(tx).byId(authSessionId);
          if (record === null || record.expiresAt.getTime() <= clock.now().getTime()) return null;
          return record.subjectId;
        }),
      completeTotpEnrolment: (input) =>
        withRealm(deps.database.db, input.realmId, (tx) => completeTotpEnrolment(tx, input, clock)),
    });
    registerLoginRoute(app, {
      findRealm,
      tls,
      ...passkeyLogin,
      ...passkeyAssertion,
      beginTotpEnrolment: startTotpEnrolment,
      ...passkeyEnrolment,
      resetAuthenticationProgress: (realmId, authSessionId) =>
        withRealm(deps.database.db, realmId, (tx) =>
          resetAuthenticationProgress(tx, authSessionId),
        ),
      advance: (realmId, authSessionId, input) =>
        withRealm(deps.database.db, realmId, (tx) =>
          advance(tx, authSessionId, input, clock, {
            ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
          }),
        ),
      loadPendingRequest: (realmId, authSessionId) =>
        withRealm(deps.database.db, realmId, (tx) => loadPendingRequest(tx, authSessionId)),
      pendingChallenge: pendingChallengeFor,
      checkEmailVerification,
      pendingActions,
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

          const { sessionId } = await establishSession(
            tx,
            input.realmId,
            input.subjectId,
            input.ssoSessionMaxSeconds,
            input.authenticators,
            clock,
          );
          // authTime and now both derive from this single clock read, not a
          // fresh one inside issueAuthorizationCode — otherwise two reads
          // straddling a millisecond boundary could store a TTL slightly
          // over 60s. On this path the two happen to be the same instant;
          // completeReuse is where they diverge.
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
            now,
            sessionId,
          });
          return { kind: 'issued', sessionId, code };
        }),
    });
    registerLogoutRoute(app, {
      findRealm,
      tls,
      listPublishableKeys,
      now: () => clock.now(),
      // Resolved from the OAuth client_id to that client's own registered
      // list — an unknown or unspecified client yields none, refusing any
      // redirect rather than resolving one with no client to trust it
      // against (RP-Initiated Logout 1.0 §3).
      postLogoutRedirectUris: (realmId, oauthClientId) =>
        withRealm(deps.database.db, realmId, async (tx) => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (client === null) return [];
          return clientOidcConfigRepository(tx).postLogoutRedirectUris(client.id);
        }),
      // The same cookie-to-live-row resolution /authorize's resolveSession
      // performs, minus the authTime that only completing a login needs.
      resolveSession: async (realm, cookieValue) => {
        if (cookieValue === undefined || !isUuid(cookieValue)) return null;
        return withRealm(deps.database.db, realm.id, async (tx) => {
          const record = await sessionRepository(tx).liveById(
            cookieValue,
            realm.ssoSessionIdleSeconds,
            clock.now(),
          );
          if (record === null) return null;
          return { id: record.id, subjectId: record.subjectId };
        });
      },
      // One transaction, per Back-Channel Logout §2.7: end the session, then
      // revoke every grant whose session_id is that session. A failure
      // anywhere rolls both back — a session that ends with its grants
      // still live would be logout not actually having happened.
      endSession: (realmId, sessionId, now) =>
        withRealm(deps.database.db, realmId, async (tx) => {
          await sessionRepository(tx).end(sessionId, now);
          await tokenGrantRepository(tx).revokeForSession(sessionId, now);
        }),
    });
    // Own encapsulation scope: `@fastify/cors`'s delegator-driven hook adds
    // `Vary: Origin` to every response it sees, including a disallowed one
    // (fetch spec — a shared cache must not serve one origin's answer to
    // another) — registered on `app` directly, it would reach the two
    // public documents, which must carry no Vary, and `/authorize` and the
    // login-actions routes, which must carry no CORS treatment at all.
    app.register((scope) => {
      registerCors(scope, {
        findRealm,
        webOriginsForRealm: (realmId) =>
          withRealm(deps.database.db, realmId, (tx) =>
            clientOidcConfigRepository(tx).webOriginsForRealm(),
          ),
      });
      registerTokenRoute(scope, {
        database: deps.database,
        findRealm,
        kek: deps.kek,
        clock,
        verifyPassword,
        claimMappers,
        loadClaimContext,
        resolveClientWebOrigins,
      });
      registerUserinfoRoute(scope, {
        findRealm,
        listPublishableKeys: (realmId) =>
          withRealm(deps.database.db, realmId, (tx) => signingKeyRepository(tx).listPublishable()),
        loadClaimContext,
        claimMappers,
        resolveRoleReach,
        resolveClientWebOrigins,
      });
    });

    return Promise.resolve();
  };
}

export { clientOidcConfigRepository } from '#/repository/client-oidc-config';
export { type ClientOidcConfig } from '#/schema/client-oidc-config';
export { realmLookupRepository, type NewRealm, type RealmLookup } from '#/repository/realm-lookup';
