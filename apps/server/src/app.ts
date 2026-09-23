import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import {
  tenantSettingsRepository,
  registerActionTokenRoute,
  registerRegistrationRoute,
  registerResetPasswordRoute,
  type CreateAccountResult,
  type NewAccountInput,
} from '@odudu/account';
import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { requiredActionRepository } from '@odudu/authn-flows';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  REUSED_PASSWORD,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { clientKeySet, oidcRoutes } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { createClientKeyRequest, defaultClientKeyLookup } from '#/client-key-transport';
import { registerHealth } from '#/health';
import { slidingWindow } from '#/throttle';

export interface AppDeps {
  readonly database: DatabaseHandle;
  /**
   * The owner (RLS-bypassing) connection, used for one thing: resolving
   * `{tenant}` from a request path before any tenant context exists to scope
   * that lookup by (ADR 0009's amendment of 2026-09-13). Required rather
   * than defaulted, because on the RLS-constrained connection the lookup
   * returns zero rows unconditionally and 404s every tenant forever, which
   * is indistinguishable from "no tenants configured". A caller that wants
   * one connection for both passes `database` again here, as `main.ts` does.
   */
  readonly ownerDatabase: DatabaseHandle;
  /**
   * Unwraps the private half of a tenant's active signing key so `/token`
   * can sign access and ID tokens — `@odudu/kernel`'s config schema already
   * decodes and length-checks `ODUDU_KEK` at the config boundary.
   */
  readonly kek: Uint8Array;
  readonly logger: PinoLogger;
  /**
   * The base a mailed verification link is built from, and the only source
   * of the WebAuthn relying party id — never derived from a request, since
   * `Host` is client-controlled (see
   * `packages/account/src/view/routes/registration.ts`). Undefined when
   * `ODUDU_PUBLIC_BASE_URL` is unset; registration then refuses to send
   * for any tenant with `verify_email` on rather than guessing one, and
   * passkey enrolment reports itself unsupported for the same reason.
   */
  readonly publicBaseUrl?: string;
  /**
   * Whether to trust `X-Forwarded-*` headers when deriving `request.ip`.
   * Defaults to `false`: with no reverse proxy in front of the server,
   * those headers are client-controlled, and `request.ip` will later feed
   * rate limiting, brute-force lockout, and audit records.
   */
  readonly trustProxy?: boolean;
  /**
   * The header a deployment's reverse proxy emits a client certificate's
   * subject under, read by `tls_client_auth` client authentication at
   * `/token` while `trustProxy` above is on. Defaults to the same value
   * `ODUDU_TLS_CLIENT_CERT_HEADER` does.
   */
  readonly tlsClientCertHeader?: string;
  /**
   * The per-origin request budget on the three unauthenticated routes that
   * each cost an Argon2id hash or a mail send. Defaults to
   * `DEFAULT_THROTTLE`; `main.ts` passes what `ODUDU_THROTTLE_*` says.
   */
  readonly throttle?: ThrottleSettings;
  /**
   * ADR 0023's other half: the per-`client_id` budget on failed
   * `client_secret_basic`/`client_secret_post` attempts at `/token`. A
   * separate instance from `throttle` above — origin and client are
   * different keys, so this is a different memory-bounded window rather
   * than a second use of the same one. Defaults to
   * `DEFAULT_CLIENT_SECRET_THROTTLE`; `main.ts` passes what
   * `ODUDU_CLIENT_SECRET_THROTTLE_*` says.
   */
  readonly clientSecretThrottle?: ThrottleSettings;
  /**
   * ADR 0028's escape hatch for a `jwks_uri` resolving to a private or
   * loopback address — the same flag `main.ts` already passes to the
   * back-channel logout transport, reused here for `private_key_jwt`'s
   * own address guard. Defaults `false`; a deployment with clients whose
   * `jwks_uri` is genuinely internal (a compose stack, a private VPC) sets
   * it explicitly rather than getting it silently.
   */
  readonly allowPrivateClientUrls?: boolean;
}

export interface ThrottleSettings {
  readonly limit: number;
  readonly windowSeconds: number;
}

export const DEFAULT_THROTTLE: ThrottleSettings = { limit: 10, windowSeconds: 60 };

// Mirrors the account lockout's own defaults (brute_force_max_failures,
// brute_force_lockout_seconds — packages/db/drizzle/0041_login_failures.sql):
// a client that legitimately fails five times in a minute is already
// unusual, and the two budgets being the same shape is easier for an
// operator to reason about than a third, unrelated pair of numbers.
export const DEFAULT_CLIENT_SECRET_THROTTLE: ThrottleSettings = { limit: 5, windowSeconds: 60 };

/**
 * The throttled routes, by the pattern Fastify matched rather than by the
 * path as it arrived, so a tenant name cannot be spelled to miss the set.
 * Deliberately not `/token`: `/token` is client-authenticated, and this
 * throttle is keyed by origin, which for a server-side client is one
 * address for every request it will ever make (ADR 0023). `/token`'s own
 * budget is `clientSecretThrottle` below, keyed by client and consulted
 * inside `authenticateClient`, not here.
 */
const THROTTLED_POSTS: ReadonlySet<string> = new Set([
  '/tenants/:tenant/login-actions/authenticate',
  '/tenants/:tenant/login-actions/registration',
  '/tenants/:tenant/login-actions/reset-password',
]);

// The composition-root half of self-registration: @odudu/account never
// imports @odudu/domain-identity (subjects, users, credentials) or
// @odudu/domain-authz (roles), so the actual writes are wired here, inside
// the one transaction packages/account/src/usecase/register.ts already
// opened around this call and the verify_email token issued alongside it.
async function createAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: NewAccountInput,
): Promise<CreateAccountResult> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId,
    username: input.username,
    email: input.email,
  });
  await credentialRepository(tx).insert({
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashPassword(input.password) },
  });
  const defaults = await roleRepository(tx).defaultsForTenant();
  for (const role of defaults) {
    await roleRepository(tx).assignToSubject(subject.id, role.id);
  }
  return { subjectId: subject.id };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify<RawServerDefault, IncomingMessage, ServerResponse>({
    loggerInstance: deps.logger,
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    trustProxy: deps.trustProxy ?? false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  const throttle = slidingWindow({
    ...(deps.throttle ?? DEFAULT_THROTTLE),
    now: () => new Date(),
  });

  // ADR 0023's client half. A distinct `slidingWindow` from `throttle`
  // above: same primitive, a different key and a different budget, so one
  // flood cannot spend the other's window.
  const clientSecretLimiter = slidingWindow({
    ...(deps.clientSecretThrottle ?? DEFAULT_CLIENT_SECRET_THROTTLE),
    now: () => new Date(),
  });

  // private_key_jwt's own address-guarded fetcher (RFC 7523 §2.2, ADR
  // 0028) — the real `node:https`/`node:dns` pair `#/client-key-transport`
  // wraps, shared by every tenant's clients the way the cache in
  // `clientKeySet` itself already assumes (protocol-oidc's own comment on
  // `negativeCacheKey`).
  const privateKeyJwtKeySet = clientKeySet({
    lookup: defaultClientKeyLookup,
    request: createClientKeyRequest(),
    now: () => new Date(),
    allowPrivate: deps.allowPrivateClientUrls ?? false,
  });

  // At onRequest, so a refusal costs neither the body parse nor anything
  // that touches the database. It is also what keeps the refusal from
  // being an oracle: nothing here has looked an account up, so a throttled
  // request cannot answer differently for an account that exists.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    const route = request.routeOptions.url;
    if (route === undefined || !THROTTLED_POSTS.has(route)) return;
    const decision = throttle.check(request.ip);
    if (decision.allowed) return;
    reply.header('retry-after', String(decision.retryAfterSeconds));
    return reply.code(429).send();
  });

  // Registered here rather than by a route: the token endpoint needs
  // form-encoded bodies and the authorization endpoint needs the session
  // cookie, and plugin registration is an app-wide concern.
  app.register(formbody);
  app.register(cookie);

  registerHealth(app, deps);
  app.register(
    oidcRoutes({
      database: deps.database,
      ownerDatabase: deps.ownerDatabase,
      kek: deps.kek,
      clientSecretLimiter,
      clientKeySet: privateKeyJwtKeySet,
      ...(deps.publicBaseUrl === undefined ? {} : { publicBaseUrl: deps.publicBaseUrl }),
      trustProxy: deps.trustProxy ?? false,
      ...(deps.tlsClientCertHeader === undefined
        ? {}
        : { tlsClientCertHeader: deps.tlsClientCertHeader }),
    }),
  );

  // getCurrentEmail, markVerified and setPassword are the only points where
  // @odudu/account reaches @odudu/domain-identity's users and credentials
  // tables — injected here, at the composition root, so @odudu/account
  // itself stays free of that dependency
  // (packages/account/src/usecase/verify-email.ts explains why).
  registerActionTokenRoute(app, {
    database: deps.database,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    setPassword: async (tx, subjectId, password) => {
      await credentialRepository(tx).setPassword(subjectId, await hashPassword(password));
    },
    getUsername: async (tx, subjectId) => {
      const user = await userRepository(tx).bySubjectId(subjectId);
      if (user === null) throw new Error(`no user found for subject ${subjectId}`);
      return user.username;
    },
    evaluatePassword,
    // A subject with no password credential at all has nothing to leave
    // unchanged, so there is nothing to refuse.
    unchangedPasswordViolations: async (tx, subjectId, candidate) => {
      const current = await credentialRepository(tx).passwordFor(subjectId);
      if (current === null) return [];
      return (await verifyPassword(current, candidate)) ? [REUSED_PASSWORD] : [];
    },
    clearPasswordUpdateAction: (tx, subjectId) =>
      requiredActionRepository(tx).complete(subjectId, 'update-password'),
  });

  registerRegistrationRoute(app, {
    database: deps.database,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    createAccount,
    evaluatePassword,
  });

  registerResetPasswordRoute(app, {
    database: deps.database,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    findByEmail: async (tx, email) => {
      const user = await userRepository(tx).byEmail(email);
      return user?.email == null ? null : { subjectId: user.subjectId, email: user.email };
    },
  });

  return app;
}
