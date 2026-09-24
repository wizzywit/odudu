import {
  admitSession,
  advance,
  authenticatedSession,
  authenticatedSubject,
  beginPasskeyAuthentication,
  beginPasskeyEnrolment,
  beginRecoveryCodes,
  beginTotpEnrolment,
  completePasskeyEnrolment,
  completeRecoveryCodes,
  completeTotpEnrolment,
  completeUpdatePassword,
  consumeAuthenticationSession,
  initialChallenge,
  loadPendingRequest,
  markSessionAuthenticated,
  pendingChallenge,
  pendingSession,
  readSessionIds,
  recordRememberMe,
  requiredActionRepository,
  resetAuthenticationProgress,
  sessionRepository,
  startAuthentication,
  type SessionLifespans,
} from '@odudu/authn-flows';
import { JWE_ALGS_PERMITTED, signingKeyRepository, signJwt } from '@odudu/crypto';
import { effectiveGroupPaths, effectiveRoles } from '@odudu/domain-authz';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { hashPassword, userRepository, verifyPassword } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository, consentRepository } from '@odudu/domain-tenant';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import { type FastifyPluginAsync } from 'fastify';
import { type ClientKeySet } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository, type ClientLogoutTarget } from '#/repository/grants';
import { logoutDeliveryRepository } from '#/repository/logout-deliveries';
import { tenantLookupRepository } from '#/repository/tenant-lookup';
import { reachableRoleIds } from '#/repository/scope-role-reach';
import { standardClaimMappers } from '#/service/claims';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import {
  USERINFO_ENCRYPTION_ENC_DEFAULT,
  USERINFO_ENCRYPTION_ENCS_PERMITTED,
} from '#/service/client-metadata';
import { logoutTokenClaims, LOGOUT_TOKEN_TYP } from '#/service/logout-token';
import { DEFAULT_TLS_CLIENT_SUBJECT_HEADER } from '#/service/tls-client-auth';
import { expandWebOrigins } from '#/service/web-origin';
import {
  issueAuthorizationCode,
  type CompleteLoginInput,
  type CompleteLoginOutcome,
} from '#/usecase/login-submission';
import { type ResolvedClient } from '#/usecase/authorization-request';
import { registerAuthorizeRoute } from '#/view/routes/authorize';
import { registerClientRegistrationRoute } from '#/view/routes/client-registration';
import { registerConsentRoute } from '#/view/routes/consent';
import { registerCors } from '#/view/routes/cors';
import { registerDiscoveryRoute } from '#/view/routes/discovery';
import { registerIntrospectRoute } from '#/view/routes/introspect';
import { registerJwksRoute } from '#/view/routes/jwks';
import { registerLoginRoute } from '#/view/routes/login';
import { registerRequiredActionRoute } from '#/view/routes/required-action';
import { registerLogoutRoute } from '#/view/routes/logout';
import { registerRevokeRoute } from '#/view/routes/revoke';
import { registerTokenRoute } from '#/view/routes/token';
import { registerUserinfoRoute } from '#/view/routes/userinfo';

export interface OidcRoutesDeps {
  database: DatabaseHandle;
  // The owner (RLS-bypassing) connection — see repository/tenant-lookup.ts
  // for why resolving {tenant} by name needs it and why that is safe.
  ownerDatabase: DatabaseHandle;
  // Unwraps the private half of the tenant's active signing key so /token
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
  // ADR 0023's client-authentication budget on /token, per client_id.
  // Required rather than defaulted: `oidcRoutes` is this package's
  // exported entry point, and a permissive default here would let an
  // embedder register the plugin with no limiter and get an RFC 6749
  // §2.3.1 MUST that silently does nothing — nothing else would catch it.
  // A caller that genuinely wants no budget says so explicitly with
  // `UNLIMITED_CLIENT_SECRET_LIMITER` (#/service/client-secret-throttle.ts).
  clientSecretLimiter: ClientSecretLimiter;
  // RFC 7523 §2.2's fetcher for a client's jwks_uri, consulted only by
  // private_key_jwt authentication at /token. Required for the same
  // reason `clientSecretLimiter` above is (see its comment); a caller
  // with no opinion says so explicitly with `NO_CLIENT_KEY_FETCHER`
  // (#/repository/client-keys.ts). `apps/server/src/app.ts` supplies the
  // real one, wired to `node:https` and `node:dns`.
  clientKeySet: ClientKeySet;
  // Gates tls_client_auth client authentication at /token the same way it
  // already gates Fastify's own `X-Forwarded-*` trust
  // (apps/server/src/app.ts). Defaults off, the same as that trust does —
  // a caller with no reverse proxy in front of it must not have a
  // proxy-supplied header trusted by default. Also what discovery's
  // `token_endpoint_auth_methods_supported` conditions `tls_client_auth`
  // on — see `resolveDiscoveryDocument`.
  trustProxy?: boolean;
  // The header a deployment's own proxy emits the certificate subject
  // under (`ODUDU_TLS_CLIENT_CERT_HEADER`) — no two proxies agree on a
  // name, so this is never a constant. Defaults to the same value the
  // kernel config schema does.
  tlsClientCertHeader?: string;
}

function hasBackchannelLogoutUri(
  target: ClientLogoutTarget,
): target is ClientLogoutTarget & { backchannelLogoutUri: string } {
  return target.backchannelLogoutUri !== null;
}

// The plugin apps/server registers. Discovery and JWKS both read the
// resolved tenant's own tenant data — its scope vocabulary and its
// publishable keys — once tenant context is established for the resolved
// tenant id.
export function oidcRoutes(deps: OidcRoutesDeps): FastifyPluginAsync {
  return (app) => {
    const findTenant = (name: string) => tenantLookupRepository(deps.ownerDatabase.db).byName(name);
    const clock = deps.clock ?? systemClock;
    const tls = deps.tls ?? false;
    const clientSecretLimiter = deps.clientSecretLimiter;
    const clientKeySet = deps.clientKeySet;
    // One registry per process, shared by discovery (claimNames, for
    // claims_supported), /userinfo, and token issuance's ID token claims —
    // so a mapper registered once reaches every consumer the same way.
    const claimMappers = standardClaimMappers();
    // Roles need a recursive CTE (effectiveRoles), which a claim mapper must
    // never run itself — resolved here, once per issuance, alongside the
    // user row and the subject's direct group memberships, and handed to
    // the mappers as data.
    const loadClaimContext = (tenantId: string, subjectId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => ({
        subjectId,
        user: await userRepository(tx).bySubjectId(subjectId),
        roles: await effectiveRoles(tx, subjectId),
        groups: await effectiveGroupPaths(tx, subjectId),
      }));

    // The keys /jwks publishes, and the ones an `id_token_hint` is checked
    // against at /authorize — one definition, so a client trusting the
    // published set and this server judging a hint cannot disagree.
    const listPublishableKeys = (tenantId: string) =>
      withTenant(deps.database.db, tenantId, (tx) => signingKeyRepository(tx).listPublishable());

    // /userinfo's own gate on the `roles` claim: which role ids the token's
    // granted scope reaches, and whether its client bypasses that
    // intersection — the same two facts token issuance reads from the same
    // tables, so a role withheld from the token cannot resurface here. A
    // disabled client never bypasses, for the reason given at
    // `resolveClientWebOrigins` below.
    const resolveRoleReach = (tenantId: string, oauthClientId: string, scope: readonly string[]) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        return {
          reachableRoleIds: await reachableRoleIds(tx, scope),
          fullScopeAllowed: client?.enabled === true && client.fullScopeAllowed,
        };
      });

    // Shared by /token and /userinfo: once each has resolved which client
    // the request is for, this is the same lookup either way — an unknown
    // or foreign client_id resolves to an empty set, so the caller withholds
    // the header instead of treating it as an error.
    const resolveClientWebOrigins = (tenantId: string, oauthClientId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        // A disabled client's origin must stop working the same way a
        // disabled client's tokens do — the CORS allowlist is not a second,
        // forgotten door into a client that was disabled for a reason.
        if (!client?.enabled) return new Set<string>();
        const config = await clientOidcConfigRepository(tx).byClientId(client.id);
        if (config === null) return new Set<string>();
        return expandWebOrigins(config.webOrigins, config.redirectUris);
      });

    // /userinfo's own answer to "should this response be a JWT": an unknown
    // or disabled client, or one that never registered
    // `userinfo_signed_response_alg`, all read as `null` — the response
    // format's default, JSON — the same way an unrecognised `client_id`
    // reads as no CORS origins above rather than an error.
    const userinfoSignedResponseAlg = (tenantId: string, oauthClientId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        if (!client?.enabled) return null;
        const config = await clientOidcConfigRepository(tx).byClientId(client.id);
        return config?.userinfoSignedResponseAlg ?? null;
      });

    // /userinfo's answer to "should this response be encrypted" — see
    // `UserinfoDeps.userinfoEncryptionTarget` (usecase/userinfo.ts) for
    // what `'none'` versus `'unavailable'` means. Registration is checked
    // before `enabled`, so a disabled client that did register reaches
    // `'unavailable'` rather than `'none'`.
    const userinfoEncryptionTarget = (tenantId: string, oauthClientId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        if (client === null) return { kind: 'none' } as const;
        const config = await clientOidcConfigRepository(tx).byClientId(client.id);
        if (config?.userinfoEncryptedResponseAlg == null) return { kind: 'none' } as const;
        if (!client.enabled) return { kind: 'unavailable' } as const;
        return {
          kind: 'target',
          target: {
            alg: config.userinfoEncryptedResponseAlg,
            enc: config.userinfoEncryptedResponseEnc ?? USERINFO_ENCRYPTION_ENC_DEFAULT,
            jwks: config.jwks,
            jwksUri: config.jwksUri,
          },
        } as const;
      });

    // The same key /token signs an access token or ID Token with —
    // `signingKeyRepository(tx).active()`, not a second selection rule.
    const activeSigningKey = (tenantId: string) =>
      withTenant(deps.database.db, tenantId, (tx) => signingKeyRepository(tx).active());

    // `null` rather than thrown: a tenant provisioned before its first
    // signing key still gets a discovery document.
    const activeSigningKeyAlg = (tenantId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        try {
          return (await signingKeyRepository(tx).active()).alg;
        } catch {
          return null;
        }
      });

    // One definition, read by discovery for scopes_supported and by
    // /authorize for what it will accept, so the advertised list and the
    // accepted one cannot drift apart.
    const scopesForTenant = (tenantId: string): Promise<readonly string[]> =>
      withTenant(deps.database.db, tenantId, async (tx) =>
        (await clientScopeRepository(tx).allForTenant()).map((scope) => scope.name),
      );

    // The one definition of "is this subject's address verified", read by
    // both doors into completing a login: the password form and a reused
    // SSO session cookie.
    const checkEmailVerification = (tenantId: string, subjectId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const user = await userRepository(tx).bySubjectId(subjectId);
        return {
          verified: user?.emailVerified ?? false,
          hasEmail: (user?.email ?? null) !== null,
        };
      });

    // The one definition of "what is this browser's live session set":
    // read by /authorize's reuse check, by login and consent to grow the
    // set with a fresh login, and by logout's membership check — never
    // trusted for anything but that lookup.
    const resolveSessions = (
      tenant: {
        id: string;
        name: string;
        ssoSessionIdleSeconds: number;
        ssoSessionMaxSeconds: number;
        rememberMeIdleSeconds: number;
        rememberMeMaxSeconds: number;
      },
      header: string | undefined,
    ) => {
      const ids = readSessionIds(header, tenant.name, tls);
      return withTenant(deps.database.db, tenant.id, (tx) =>
        sessionRepository(tx).liveByIds([...ids.ephemeral, ...ids.persistent], tenant, clock.now()),
      );
    };

    // Whether the login page offers a passkey button at all: the relying
    // party id comes from ODUDU_PUBLIC_BASE_URL and nowhere else, so
    // without it there is nothing behind one.
    const passkeyLogin = { passkeyLogin: deps.publicBaseUrl !== undefined };

    // One definition for every door that can issue a code: the form path,
    // the consent POST, and (via completeAuthorizedLogin) whichever of the
    // two a reuse's own consent gate promoted itself into.
    const resolveClientId = (tenantId: string, oauthClientId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const client = await clientRepository(tx).byClientId(oauthClientId);
        return client === null ? null : client.id;
      });

    // What a consent decision needs about the client, read once per call
    // and shared by decideConsentGate (both doors) and the consent POST
    // that records the answer: the client's own display name, whether it
    // requires consent at all, and its scope vocabulary split by
    // assignment — named, not just counted, so the page can list them and
    // the POST can turn a ticked name back into the id consent_scopes
    // stores.
    const consentContext = (tenantId: string, clientId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const [client, config, assignments] = await Promise.all([
          clientRepository(tx).byId(clientId),
          clientOidcConfigRepository(tx).byClientId(clientId),
          clientScopeRepository(tx).forClientByAssignment(clientId),
        ]);
        const defaultScopes = assignments
          .filter((row) => row.assignment === 'default')
          .map((row) => row.scope.name);
        const optionalScopes = assignments
          .filter((row) => row.assignment === 'optional')
          .map((row) => row.scope.name);
        const scopeIdByName = new Map(assignments.map((row) => [row.scope.name, row.scope.id]));
        return {
          clientName: client?.name ?? '',
          consentRequired: config?.consentRequired ?? false,
          defaultScopes,
          optionalScopes,
          scopeIdByName,
        };
      });

    const grantedScopeIds = (tenantId: string, subjectId: string, clientId: string) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        consentRepository(tx).grantedScopeIds(tenantId, subjectId, clientId),
      );

    // One transaction: the conditional consume, and — only if it actually
    // consumed the session — establishing the SSO session and issuing the
    // code. A failure anywhere in here rolls all three back together, so it
    // never leaves a consumed session with nothing issued for it. Shared by
    // the form path and the consent POST — completeAuthorizedLogin is the
    // only caller of either.
    const completeLogin = (input: CompleteLoginInput): Promise<CompleteLoginOutcome> =>
      withTenant(deps.database.db, input.tenantId, async (tx) => {
        const now = clock.now();
        const consumed = await consumeAuthenticationSession(tx, input.authSessionId, clock);
        if (!consumed) return { kind: 'already_consumed' };

        // A session reuse a consent decision promoted: touch and reuse it,
        // reporting its own authTime, rather than establishing a fresh
        // session and reporting `now` — the same distinction completeReuse
        // draws for the ungated reuse path, and for the same reason: being
        // asked for consent must not itself read as a new authentication.
        const reuseSession = input.reuseSession;
        let sessionId: string;
        let authTime: Date;
        if (reuseSession !== undefined) {
          await sessionRepository(tx).touch(reuseSession.sessionId, now);
          sessionId = reuseSession.sessionId;
          authTime = reuseSession.authTime;
        } else {
          const admitted = await admitSession(
            tx,
            {
              tenantId: input.tenantId,
              subjectId: input.subjectId,
              authenticators: input.authenticators,
              remembered: input.remembered,
              browserSessionIds: input.browserSessionIds,
              maxSessionsPerBrowser: input.maxSessionsPerBrowser,
              lifespans: input.lifespans,
            },
            clock,
          );
          sessionId = admitted.sessionId;
          authTime = now;
        }

        const { code } = await issueAuthorizationCode(tx, {
          tenantId: input.tenantId,
          clientId: input.clientId,
          subjectId: input.subjectId,
          redirectUri: input.redirectUri,
          scope: input.scope,
          nonce: input.nonce,
          codeChallenge: input.codeChallenge,
          codeChallengeMethod: input.codeChallengeMethod,
          authTime,
          now,
          sessionId,
          resource: input.resource,
          claims: input.claims,
        });
        return { kind: 'issued', sessionId, code };
      });

    registerDiscoveryRoute(app, {
      findTenant,
      claimNames: () => claimMappers.claimNames(),
      scopesForTenant,
      activeSigningKeyAlg,
      userinfoEncryptionAlgSupported: JWE_ALGS_PERMITTED,
      userinfoEncryptionEncSupported: USERINFO_ENCRYPTION_ENCS_PERMITTED,
      trustProxy: deps.trustProxy ?? false,
    });
    registerJwksRoute(app, { findTenant, listPublishableKeys });
    // Introspection's two grant/session reads, resolved here rather than in
    // the route — a route never imports a repository (dependency-cruiser's
    // no-view-to-repository rule; see token.ts's own `findTenant` comment for
    // the same rule stated where /token obeys it).
    const loadIntrospectionGrant = (tenantId: string, grantId: string) =>
      withTenant(deps.database.db, tenantId, async (tx) => {
        const grant = await tokenGrantRepository(tx).byId(grantId);
        return grant === null ? null : { revokedAt: grant.revokedAt };
      });
    const isIntrospectionSessionLive = (
      tenantId: string,
      sessionId: string,
      lifespans: SessionLifespans,
      now: Date,
    ) =>
      withTenant(
        deps.database.db,
        tenantId,
        async (tx) => (await sessionRepository(tx).liveById(sessionId, lifespans, now)) !== null,
      );
    // No CORS scope: unlike /userinfo, a resource server calls this with
    // its own client credentials, never a browser holding a bearer token,
    // so there is no Origin this endpoint owes a header to.
    registerIntrospectRoute(app, {
      database: deps.database,
      findTenant,
      listPublishableKeys,
      verifyPassword,
      clientSecretLimiter,
      loadGrant: loadIntrospectionGrant,
      isSessionLive: isIntrospectionSessionLive,
      clock,
    });
    // Same no-CORS reasoning as /introspect above: a client revokes its own
    // token with its own credentials, never a browser bearer token.
    registerRevokeRoute(app, {
      database: deps.database,
      findTenant,
      listPublishableKeys,
      verifyPassword,
      clientSecretLimiter,
      clock,
    });
    registerClientRegistrationRoute(app, {
      findTenant,
      withinTenant: (tenantId, fn) => withTenant(deps.database.db, tenantId, fn),
      hashClientSecret: hashPassword,
      now: () => clock.now(),
      tlsClientAuthEnabled: deps.trustProxy ?? false,
    });
    // One definition for both doors onto the enrolment page: the login
    // submission that discovers the action is owed, and the enrolment
    // submission that has to re-render it after a wrong code.
    const startTotpEnrolment = (tenantName: string, tenantId: string, subjectId: string) =>
      withTenant(deps.database.db, tenantId, (tx) => beginTotpEnrolment(tx, tenantName, subjectId));

    // One definition for the same two doors: the login that discovers the
    // action is owed, and the acknowledgement that has to re-render it.
    const startRecoveryCodes = (tenantId: string, subjectId: string) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        beginRecoveryCodes(tx, { tenantId, subjectId }),
      );

    // Both halves of passkey enrolment exist only where a relying party can
    // be derived; where it cannot, the routes have nothing to call and say
    // so, rather than naming a domain nobody configured.
    const publicBaseUrl = deps.publicBaseUrl;
    const passkeyEnrolment =
      publicBaseUrl === undefined
        ? {}
        : {
            beginPasskeyEnrolment: (
              tenantName: string,
              tenantId: string,
              subjectId: string,
              authSessionId: string,
            ) =>
              withTenant(deps.database.db, tenantId, (tx) =>
                beginPasskeyEnrolment(tx, {
                  tenantName,
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
            beginPasskeyAuthentication: (tenantId: string, authSessionId: string) =>
              withTenant(deps.database.db, tenantId, (tx) =>
                beginPasskeyAuthentication(tx, { publicBaseUrl, authSessionId }),
              ),
          };

    const passkeySubmission =
      publicBaseUrl === undefined
        ? {}
        : {
            completePasskeyEnrolment: (input: {
              tenantId: string;
              subjectId: string;
              authSessionId: string;
              response: unknown;
              label?: string;
            }) =>
              withTenant(deps.database.db, input.tenantId, (tx) =>
                completePasskeyEnrolment(tx, { ...input, publicBaseUrl }),
              ),
          };

    const pendingChallengeFor = (tenantId: string, authSessionId: string) =>
      withTenant(deps.database.db, tenantId, (tx) => pendingChallenge(tx, authSessionId, clock));

    // One definition for both readers: the login gate that discovers an
    // action is owed, and the required-action route that will not act on
    // one that is not.
    const pendingActions = (tenantId: string, subjectId: string) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        requiredActionRepository(tx).pendingFor(subjectId),
      );

    registerAuthorizeRoute(app, {
      findTenant,
      tls,
      ...passkeyLogin,
      listPublishableKeys,
      scopesForTenant,
      resolveClient: (tenantId, oauthClientId) =>
        withTenant(deps.database.db, tenantId, async (tx): Promise<ResolvedClient> => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (client === null) return { client: null, config: null, scopes: [] };
          const config = await clientOidcConfigRepository(tx).byClientId(client.id);
          const assigned = await clientScopeRepository(tx).forClient(client.id);
          return { client, config, scopes: assigned.map((scope) => scope.name) };
        }),
      startAuthentication: (tenantId, request) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          startAuthentication(tx, tenantId, request, clock),
        ),
      initialChallenge: (tenantId) =>
        withTenant(deps.database.db, tenantId, (tx) => initialChallenge(tx, tenantId)),
      now: () => clock.now(),
      resolveSessions,
      checkEmailVerification,
      pendingActions,
      beginTotpEnrolment: startTotpEnrolment,
      beginRecoveryCodes: startRecoveryCodes,
      ...passkeyEnrolment,
      consentContext,
      grantedScopeIds,
      // The account chooser's own POST reads back the request a 'select'
      // outcome parked here. Unlike login.ts's and consent.ts's own
      // loadPendingRequest calls below, this session was never bound to a
      // subject, so authenticatedSession's own liveness check cannot gate
      // it — pendingSession applies the same expiry/consumed checks to a
      // session that has not yet been authenticated.
      loadPendingRequest: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) => pendingSession(tx, authSessionId, clock)),
      // The chooser's label for each candidate: preferred_username falling
      // back to username, the same fallback #/service/claims.ts uses for
      // the preferred_username claim itself — never email, which the
      // chooser must not print on a shared device.
      accountDisplayNames: (tenantId, subjectIds) =>
        withTenant(deps.database.db, tenantId, async (tx) => {
          const names = new Map<string, string>();
          for (const subjectId of new Set(subjectIds)) {
            const user = await userRepository(tx).bySubjectId(subjectId);
            if (user !== null) names.set(subjectId, user.preferredUsername ?? user.username);
          }
          return names;
        }),
      // Promotes a reuse into a real authentication session, already bound
      // and authenticated for the reused subject — what the required-action
      // gate and decideConsentGate's 'ask' branch both need to park the
      // request on and render a page against, with no factor actually
      // running.
      markAuthenticated: (tenantId, authSessionId, subjectId, authenticators) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          markSessionAuthenticated(tx, authSessionId, subjectId, authenticators, clock),
        ),
      // Touch and issue in one transaction: a reused session is a session
      // being used, and there is no reason for the two writes this makes to
      // land in separate ones.
      completeReuse: (input) =>
        withTenant(deps.database.db, input.tenantId, async (tx) => {
          const now = clock.now();
          await sessionRepository(tx).touch(input.sessionId, now);
          // `now`, not `input.authTime`: the code's 60s TTL counts from this
          // issuance, however long ago the session's own login was.
          return issueAuthorizationCode(tx, {
            tenantId: input.tenantId,
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
            resource: input.resource,
            claims: input.claims,
          });
        }),
    });

    registerRequiredActionRoute(app, {
      findTenant,
      ...passkeyLogin,
      beginTotpEnrolment: startTotpEnrolment,
      ...passkeyEnrolment,
      ...passkeySubmission,
      pendingChallenge: pendingChallengeFor,
      pendingActions,
      authenticatedSubject: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          authenticatedSubject(tx, authSessionId, clock),
        ),
      completeTotpEnrolment: (input) =>
        withTenant(deps.database.db, input.tenantId, (tx) =>
          completeTotpEnrolment(tx, input, clock),
        ),
      beginRecoveryCodes: startRecoveryCodes,
      completeRecoveryCodes: (input) =>
        withTenant(deps.database.db, input.tenantId, (tx) => completeRecoveryCodes(tx, input)),
      completeUpdatePassword: (input) =>
        withTenant(deps.database.db, input.tenantId, (tx) => completeUpdatePassword(tx, input)),
    });
    registerLoginRoute(app, {
      findTenant,
      tls,
      ...passkeyLogin,
      ...passkeyAssertion,
      beginTotpEnrolment: startTotpEnrolment,
      beginRecoveryCodes: startRecoveryCodes,
      ...passkeyEnrolment,
      resetAuthenticationProgress: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          resetAuthenticationProgress(tx, authSessionId),
        ),
      recordRememberMe: (tenantId, authSessionId, remembered) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          recordRememberMe(tx, authSessionId, remembered),
        ),
      advance: (tenantId, authSessionId, input) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          advance(tx, authSessionId, input, clock, {
            ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
          }),
        ),
      loadPendingRequest: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) => loadPendingRequest(tx, authSessionId)),
      pendingChallenge: pendingChallengeFor,
      checkEmailVerification,
      pendingActions,
      resolveClientId,
      consentContext,
      grantedScopeIds,
      completeLogin,
      resolveSessions,
    });
    registerConsentRoute(app, {
      findTenant,
      tls,
      authenticatedSession: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          authenticatedSession(tx, authSessionId, clock),
        ),
      loadPendingRequest: (tenantId, authSessionId) =>
        withTenant(deps.database.db, tenantId, (tx) => loadPendingRequest(tx, authSessionId)),
      checkEmailVerification,
      pendingActions,
      beginTotpEnrolment: startTotpEnrolment,
      beginRecoveryCodes: startRecoveryCodes,
      ...passkeyEnrolment,
      resolveClientId,
      consentContext,
      recordConsent: (tenantId, subjectId, clientId, scopeIds) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          consentRepository(tx).record(tenantId, subjectId, clientId, [...scopeIds]),
        ),
      completeLogin,
      resolveSessions,
    });
    registerLogoutRoute(app, {
      findTenant,
      tls,
      listPublishableKeys,
      now: () => clock.now(),
      // Resolved from the OAuth client_id to that client's own registered
      // list — an unknown, disabled or unspecified client yields none,
      // refusing any redirect rather than resolving one with no client (or
      // no longer-trusted client) to trust it against (RP-Initiated Logout
      // 1.0 §3).
      postLogoutRedirectUris: (tenantId, oauthClientId) =>
        withTenant(deps.database.db, tenantId, async (tx) => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (!client?.enabled) return [];
          return clientOidcConfigRepository(tx).postLogoutRedirectUris(client.id);
        }),
      resolveSessions,
      // One transaction, per Back-Channel Logout §2.7: end the session,
      // revoke every grant whose session_id is that session, then mint and
      // enqueue one delivery per client that used the session and
      // registered a back-channel URI. A failure anywhere rolls all of it
      // back — see the JSDoc on LogoutUsecaseDeps.endSession for why. Two
      // concurrent logouts on the same session both reach here and both
      // attempt to enqueue; logoutDeliveryRepository.enqueue's own comment
      // is why that yields one delivery, not two.
      endSession: (tenantId, sessionId, subjectId, now, issuer) =>
        withTenant(deps.database.db, tenantId, async (tx) => {
          await sessionRepository(tx).end(sessionId, now);
          await tokenGrantRepository(tx).revokeForSession(sessionId, now);

          const targets = await tokenGrantRepository(tx).clientsForSession(sessionId);
          const backchannelTargets = targets.filter(hasBackchannelLogoutUri);
          if (backchannelTargets.length === 0) return;

          const key = await signingKeyRepository(tx).active();
          const deliveries = await Promise.all(
            backchannelTargets.map(async (target) => {
              const claims = logoutTokenClaims({
                issuer,
                audience: target.oauthClientId,
                subject: subjectId,
                sessionId,
                now,
              });
              const logoutToken = await signJwt(
                { ...claims },
                { key, kek: deps.kek, typ: LOGOUT_TOKEN_TYP },
              );
              return {
                id: newId(),
                tenantId,
                clientId: target.clientId,
                sessionId,
                endpoint: target.backchannelLogoutUri,
                logoutToken,
                nextAttemptAt: now,
              };
            }),
          );
          await logoutDeliveryRepository(tx).enqueue(deliveries);
        }),
      // Front-Channel Logout 1.0 §3's "set of logged-in RPs" — read after
      // endSession above has already revoked the session's grants, since
      // revoking one only stamps revoked_at rather than removing it.
      clientsForSession: (tenantId, sessionId) =>
        withTenant(deps.database.db, tenantId, (tx) =>
          tokenGrantRepository(tx).clientsForSession(sessionId),
        ),
    });
    // Own encapsulation scope: `@fastify/cors`'s delegator-driven hook adds
    // `Vary: Origin` to every response it sees, including a disallowed one
    // (fetch spec — a shared cache must not serve one origin's answer to
    // another) — registered on `app` directly, it would reach the two
    // public documents, which must carry no Vary, and `/authorize` and the
    // login-actions routes, which must carry no CORS treatment at all.
    app.register((scope) => {
      registerCors(scope, {
        findTenant,
        webOriginsForTenant: (tenantId) =>
          withTenant(deps.database.db, tenantId, (tx) =>
            clientOidcConfigRepository(tx).webOriginsForTenant(),
          ),
      });
      registerTokenRoute(scope, {
        database: deps.database,
        findTenant,
        kek: deps.kek,
        clock,
        verifyPassword,
        clientSecretLimiter,
        claimMappers,
        loadClaimContext,
        resolveClientWebOrigins,
        clientKeySet,
        trustProxy: deps.trustProxy ?? false,
        tlsClientCertHeader: deps.tlsClientCertHeader ?? DEFAULT_TLS_CLIENT_SUBJECT_HEADER,
      });
      registerUserinfoRoute(scope, {
        findTenant,
        listPublishableKeys: (tenantId) =>
          withTenant(deps.database.db, tenantId, (tx) =>
            signingKeyRepository(tx).listPublishable(),
          ),
        loadClaimContext,
        claimMappers,
        resolveRoleReach,
        resolveClientWebOrigins,
        userinfoSignedResponseAlg,
        activeSigningKey,
        userinfoEncryptionTarget,
        clientKeySet,
        kek: deps.kek,
        loadGrant: loadIntrospectionGrant,
        isSessionLive: isIntrospectionSessionLive,
        clock,
      });
    });

    return Promise.resolve();
  };
}

// The admin API verifies a bearer token's `iss` the same way /userinfo
// does (packages/protocol-admin/src/usecase/authenticate-admin.ts).
export { tenantIssuerFor } from '#/view/issuer';
export { assertionJtiRepository } from '#/repository/assertion-jti';
export { clientOidcConfigRepository } from '#/repository/client-oidc-config';
export { type ClientOidcConfig } from '#/schema/client-oidc-config';
export { GRANT_TYPES_PERMITTED } from '#/service/client-metadata';
export {
  tenantLookupRepository,
  type NewTenant,
  type TenantLookup,
} from '#/repository/tenant-lookup';
export {
  clientKeySet,
  ClientKeySetRefused,
  MAX_JWKS_BYTES,
  NO_CLIENT_KEY_FETCHER,
  type ClientKeyDeps,
  type ClientKeyRequest,
  type ClientKeyResponse,
  type ClientKeySet,
} from '#/repository/client-keys';
export {
  logoutDeliveryRepository,
  BACKCHANNEL_LOGOUT_MAX_ATTEMPTS,
  BACKCHANNEL_LOGOUT_RETRY_BACKOFF_SECONDS,
  type ClaimDue,
  type EnqueueDelivery,
} from '#/repository/logout-deliveries';
export {
  sendLogouts,
  type ClaimedLogoutDelivery,
  type LogoutDeliveryResponse,
  type LogoutDeliveryTransport,
  type SendLogoutsDeps,
  type SendLogoutsOutcome,
} from '#/usecase/send-logouts';
export {
  assertFetchableUrl,
  assertPublicAddresses,
  RemoteAddressRefused,
} from '#/service/remote-address';
// The admin API's grant and session liveness checks read these directly
// (packages/protocol-admin/src/testing/admin-fixture.ts and the
// authentication chain it exists to test).
export { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
export {
  UNLIMITED_CLIENT_SECRET_LIMITER,
  type ClientSecretLimiter,
} from '#/service/client-secret-throttle';
