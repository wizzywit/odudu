import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import {
  actionTokenRepository,
  enqueueActionsLink,
  enqueueResetLink,
  enqueueVerificationLink,
  tenantSettingsRepository,
  registerActionTokenRoute,
  registerRegistrationRoute,
  registerResetPasswordRoute,
  type CreateAccountResult,
  type NewAccountInput,
  type TakenIdentifiers,
  type VerifiedAccountInput,
  type MailGate,
} from '@odudu/account';
import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { createBranding, type Branding } from '#/branding';
import { createMailLook } from '#/mail-look';
import { createDatabaseMessageOverrides, type MessageOverrides } from '#/message-overrides';
import {
  isOverridableMessageKey,
  isThemeMessageKey,
  overrideProblemFor,
  pageMessageCatalogue,
} from '#/theme-message-keys';
import { THEME_PREVIEW_PAGES } from '#/theme-preview-pages';
import { brandRoutes, frameworkError } from '#/brand-routes';
import { requiredActionRepository } from '@odudu/authn-flows';
import { consoleGateway } from '@odudu/console-gateway';
import { instrumentRoutes } from '@odudu/instrument';
import {
  credentialRepository,
  evaluatePassword,
  hashUserPassword,
  isEmailAddress,
  lockEmailForCreation,
  REUSED_PASSWORD,
  subjectRepository,
  userRepository,
  verifyUserPassword,
} from '@odudu/domain-identity';
import {
  DEFAULT_CONSOLE_DIR,
  DEFAULT_INSTRUMENT_DIR,
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  newId,
  systemClock,
} from '@odudu/kernel';
import { adminRoutes, composeUserSubject } from '@odudu/protocol-admin';
import {
  clientKeySet,
  configureIssuerBase,
  endAllAccess,
  tenantIssuerFor,
  oidcRoutes,
  answerNotFound,
  answerServerError,
  sendThrottledPage,
  type UnroutedDeps,
  standardClaimMappers,
  type AuditRefusalBudget,
} from '@odudu/protocol-oidc';
import { docsRoutes } from '@odudu/web-assets';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type RouteOptions,
  type RawServerDefault,
} from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { findHeldSignInIn } from '#/held-sign-in';
import { createClientKeyRequest, defaultClientKeyLookup } from '#/client-key-transport';
import { type ConsoleKeys, missingConsoleKey } from '#/console-key';
import { registerHealth } from '#/health';
import { type RateLimiter, slidingWindow } from '#/throttle';
import { mailGate as createMailGate } from '#/mail-limiter';
import { neutraliseRequestInput } from '#/input-hygiene';
import { loginBudgetKey } from '#/login-throttle';
import { throttleOrigin } from '#/throttle-origin';

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
  // How pages get their theme; a test passes its own. Defaults to the
  // process's resolver over `database`.
  readonly branding?: Branding;
  readonly messageOverrides?: MessageOverrides;
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
   * `publicBaseUrl` while the console is on, and unset while it is off: a
   * tenant created through the admin API is registered the console's
   * redirect and post-logout URIs under it.
   */
  readonly consoleBaseUrl?: string | undefined;
  /**
   * The key the gateway authenticates with as every tenant's admin client,
   * and the public set a tenant created through the admin API registers.
   * Required with `consoleBaseUrl`: a console that cannot authenticate
   * would fail every sign-in rather than the boot.
   */
  readonly consoleKeys?: ConsoleKeys | undefined;
  /**
   * `ODUDU_CONSOLE_DIR`: the built single-page app the gateway serves under
   * `/console/*`. Defaults to the same path the config schema does, so a
   * caller with no reason to move it can leave it unset.
   */
  readonly consoleDir?: string;
  /**
   * `ODUDU_INSTRUMENT_DIR`: the built stylesheet and fonts every rendered
   * page links, read once at registration.
   */
  readonly instrumentDir?: string;
  /**
   * `ODUDU_DOCS_DIR` while `ODUDU_DOCS` is on: the built documentation served
   * under `/docs`. Unset registers nothing, so `/docs` is as unknown as any
   * other path.
   */
  readonly docsDir?: string | undefined;
  /**
   * Whether the session and sign-in cookies take the `__Host-` / `__Secure-`
   * prefix and `Secure`. One value for the cookie the login page sets and the
   * pages that read it back, so the two cannot disagree.
   * `ODUDU_TLS`; required, so a caller cannot lose it silently.
   */
  readonly tls: boolean;
  /** The console gateway's clock, so a test can age a pending sign-in. */
  readonly consoleNow?: () => Date;
  /** Called with every route as it is registered, for a tool that lists what the app serves. */
  readonly onRoute?: (route: RouteOptions) => void;
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
   * Whether a mail may be queued for an address now (verification, reset,
   * "you already have an account"). Defaults to `mailGate` in
   * `#/mail-limiter`: three an hour per tenant and address, in process.
   */
  readonly mailGate?: MailGate;
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
   * The budget per address and username on the sign-in submission alone,
   * beside the per-origin one: credential stuffing against one account
   * from one address is refused sooner without punishing a whole NAT.
   * Defaults to `DEFAULT_LOGIN_THROTTLE`; `main.ts` passes what
   * `ODUDU_LOGIN_THROTTLE_*` says.
   */
  readonly loginThrottle?: ThrottleSettings;
  /**
   * ADR 0028's escape hatch for a `jwks_uri` resolving to a private or
   * loopback address — the same flag `main.ts` already passes to the
   * back-channel logout transport, reused here for `private_key_jwt`'s
   * own address guard. Defaults `false`; a deployment with clients whose
   * `jwks_uri` is genuinely internal (a compose stack, a private VPC) sets
   * it explicitly rather than getting it silently.
   */
  readonly allowPrivateClientUrls?: boolean;
  /**
   * The same escape hatch for the relay a tenant configures through
   * `PUT /smtp`. Separate from `allowPrivateClientUrls` because an
   * internal mail relay is an ordinary production shape, where a private
   * `jwks_uri` is not. Defaults `false`; loopback stays refused either way.
   */
  readonly allowPrivateSmtpHosts?: boolean;
  /**
   * Whether the deployment has an SMTP sender of its own, which a tenant
   * with no relay of its own falls back to. Defaults `false`.
   */
  readonly deploymentSmtp?: boolean;
  /** `ODUDU_OUTBOX_MAX_ATTEMPTS`, what the admin API's mail listing calls `failed`. */
  readonly outboxMaxAttempts?: number;
}

export interface ThrottleSettings {
  readonly limit: number;
  readonly windowSeconds: number;
}

export const DEFAULT_THROTTLE: ThrottleSettings = { limit: 10, windowSeconds: 60 };

export const DEFAULT_LOGIN_THROTTLE: ThrottleSettings = { limit: 5, windowSeconds: 60 };

// Mirrors the account lockout's own defaults (brute_force_max_failures,
// brute_force_lockout_seconds — packages/db/drizzle/0041_login_failures.sql):
// a client that legitimately fails five times in a minute is already
// unusual, and the two budgets being the same shape is easier for an
// operator to reason about than a third, unrelated pair of numbers.
export const DEFAULT_CLIENT_SECRET_THROTTLE: ThrottleSettings = { limit: 5, windowSeconds: 60 };

// ADR 0037: the most refusal rows one registered client can put in the
// audit table per window, the last of them saying the budget ran out. Past
// it, refusals are warn lines until the window reopens.
export const AUDIT_REFUSAL_ROWS_PER_CLIENT = 20;
export const AUDIT_REFUSAL_WINDOW_SECONDS = 60;

export function auditRefusalBudget(now: () => Date): AuditRefusalBudget {
  const rows: RateLimiter = slidingWindow({
    limit: AUDIT_REFUSAL_ROWS_PER_CLIENT - 1,
    windowSeconds: AUDIT_REFUSAL_WINDOW_SECONDS,
    now,
  });
  const closing: RateLimiter = slidingWindow({
    limit: 1,
    windowSeconds: AUDIT_REFUSAL_WINDOW_SECONDS,
    now,
  });
  return {
    take: (key) => {
      if (rows.check(key).allowed) return 'row';
      return closing.check(key).allowed ? 'last_row' : 'log';
    },
  };
}

/**
 * The throttled routes, by the pattern Fastify matched rather than by the
 * path as it arrived, so a tenant name cannot be spelled to miss the set.
 * Deliberately not `/token`: `/token` is client-authenticated, and this
 * throttle is keyed by origin, which for a server-side client is one
 * address for every request it will ever make (ADR 0023). `/token`'s own
 * budget is `clientSecretThrottle` below, keyed by client and consulted
 * inside `authenticateClient`, not here.
 */
const SIGN_IN_POST = '/tenants/:tenant/login-actions/authenticate';

// A person at a browser reads these refusals, so they answer with a page; the
// admin routes below are called by a client and keep a bare 429.
const PAGE_POSTS: ReadonlySet<string> = new Set([
  SIGN_IN_POST,
  '/tenants/:tenant/login-actions/registration',
  '/tenants/:tenant/login-actions/reset-password',
]);

const THROTTLED_POSTS: ReadonlySet<string> = new Set([
  ...PAGE_POSTS,
  '/admin/tenants/:tenant/subjects/:id/password-reset',
  '/admin/tenants/:tenant/subjects/:id/verification',
  '/admin/tenants/:tenant/subjects/:id/actions-email',
  '/admin/tenants/:tenant/smtp/test',
]);

// The composition-root half of self-registration: @odudu/account never
// imports @odudu/domain-identity (subjects, users, credentials) or
// @odudu/domain-authz (roles), so the actual writes are wired here, inside
// the one transaction packages/account/src/usecase/register.ts already
// opened around this call and the verify_email token issued alongside it.
// `composeUserSubject` (@odudu/protocol-admin) is the subject/user/default-roles
// half shared with administrative subject creation — this adds only the
// password credential self-registration owns and the admin door does not.
async function createAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: NewAccountInput,
): Promise<CreateAccountResult> {
  const { subjectId } = await composeUserSubject(tx, {
    tenantId,
    username: input.username,
    email: input.email,
    selfRegistered: true,
  });
  await credentialRepository(tx).insert({
    tenantId,
    subjectId,
    type: 'password',
    secret: { kind: 'password', hash: await hashUserPassword(input.password) },
  });
  return { subjectId };
}

async function findTaken(
  tx: TenantScopedDatabase,
  _tenantId: string,
  who: { username: string; email: string },
): Promise<TakenIdentifiers> {
  const users = userRepository(tx);
  const byName = await users.byUsername(who.username);
  return { username: byName !== null, emailOwner: await users.holderOfEmail(who.email) };
}

// A registration that waited for its mailed link: the hash register made, an
// address the link has proved, and the same subject, roles and groups as any
// other new account.
async function createVerifiedAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: VerifiedAccountInput,
): Promise<CreateAccountResult> {
  const { subjectId } = await composeUserSubject(tx, {
    tenantId,
    username: input.username,
    email: input.email,
  });
  await userRepository(tx).markEmailVerified(subjectId);
  await credentialRepository(tx).insert({
    tenantId,
    subjectId,
    type: 'password',
    secret: { kind: 'password', hash: input.passwordHash },
  });
  return { subjectId };
}

function refuse(reply: FastifyReply, route: string, retryAfterSeconds: number): FastifyReply {
  if (PAGE_POSTS.has(route)) return sendThrottledPage(reply, retryAfterSeconds);
  return reply.header('retry-after', String(retryAfterSeconds)).code(429).send();
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify<RawServerDefault, IncomingMessage, ServerResponse>({
    loggerInstance: deps.logger,
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    frameworkErrors: frameworkError,
    trustProxy: deps.trustProxy ?? false,
  });

  const tls = deps.tls;
  // The issuer is the configured public address wherever one is stated, for the
  // OIDC routes and the admin API alike; never what a Host header says.
  configureIssuerBase(app, deps.publicBaseUrl);

  if (deps.onRoute !== undefined) app.addHook('onRoute', deps.onRoute);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // The root answers for every path nothing claims and every route with no
  // error scope of its own (the admin and console scopes keep theirs). A
  // browser navigation gets a page, anything else a problem document.
  const unrouted: UnroutedDeps = {
    links: {
      ...(deps.consoleBaseUrl === undefined
        ? {}
        : { console: new URL('/console/', deps.consoleBaseUrl).href }),
      ...(deps.docsDir === undefined ? {} : { docs: '/docs/' }),
    },
  };
  app.setNotFoundHandler((request, reply) => answerNotFound(request, reply, unrouted));
  app.setErrorHandler<FastifyError>((error, request, reply) =>
    answerServerError(error, request, reply),
  );

  const throttle: RateLimiter = slidingWindow({
    ...(deps.throttle ?? DEFAULT_THROTTLE),
    now: () => new Date(),
  });

  // ADR 0023's client half. A distinct `slidingWindow` from `throttle`
  // above: same primitive, a different key and a different budget, so one
  // flood cannot spend the other's window.
  const clientSecretLimiter: RateLimiter = slidingWindow({
    ...(deps.clientSecretThrottle ?? DEFAULT_CLIENT_SECRET_THROTTLE),
    now: () => new Date(),
  });

  const loginLimiter: RateLimiter = slidingWindow({
    ...(deps.loginThrottle ?? DEFAULT_LOGIN_THROTTLE),
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

  // One instance for the process, shared by `oidcRoutes` (issuance and
  // discovery) and `adminRoutes` (`GET /scopes/:id/mappers`'s available
  // names) — so the two can never disagree about which mappers exist.
  const claimMappers = standardClaimMappers();

  // At onRequest, so a refusal costs neither the body parse nor anything
  // that touches the database. It is also what keeps the refusal from
  // being an oracle: nothing here has looked an account up, so a throttled
  // request cannot answer differently for an account that exists.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    const route = request.routeOptions.url;
    if (route === undefined || !THROTTLED_POSTS.has(route)) return;
    const decision = throttle.check(throttleOrigin(request.ip));
    if (decision.allowed) return;
    return refuse(reply, route, decision.retryAfterSeconds);
  });

  // Under /tenants, before anything reads a value: a NUL or a lone surrogate
  // in a name, a form field, a query parameter or the tenant segment cannot
  // be a database parameter, so it is made one no account answers to.
  app.addHook('preValidation', (request, _reply, done) => {
    if (request.routeOptions.url?.startsWith('/tenants/') === true) {
      neutraliseRequestInput(request);
    }
    done();
  });

  // The composite budget needs the form, so it waits for the body parse —
  // still before the route runs, so before any account lookup or Argon2id
  // verification — and answers the same bytes the per-origin refusal does.
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    if (request.routeOptions.url !== SIGN_IN_POST) return;
    const params = request.params as { tenant?: string };
    const key = loginBudgetKey(throttleOrigin(request.ip), params.tenant ?? '', request.body);
    if (key === undefined) return;
    const decision = loginLimiter.check(key);
    if (decision.allowed) return;
    return refuse(reply, SIGN_IN_POST, decision.retryAfterSeconds);
  });

  // Registered here rather than by a route: the token endpoint needs
  // form-encoded bodies and the authorization endpoint needs the session
  // cookie, and plugin registration is an app-wide concern.
  app.register(formbody);
  app.register(cookie);

  registerHealth(app, deps);
  app.register(instrumentRoutes(deps.instrumentDir ?? DEFAULT_INSTRUMENT_DIR));
  app.register(
    brandRoutes({
      database: deps.database,
      ownerDatabase: deps.ownerDatabase,
      publicBaseUrl: deps.publicBaseUrl,
    }),
  );
  if (deps.docsDir !== undefined) app.register(docsRoutes(deps.docsDir));
  if (deps.consoleBaseUrl !== undefined) {
    if (deps.consoleKeys === undefined) throw missingConsoleKey();
    app.register(
      consoleGateway({
        database: deps.database,
        ownerDatabase: deps.ownerDatabase,
        kek: deps.kek,
        publicBaseUrl: deps.consoleBaseUrl,
        clientKey: deps.consoleKeys.key,
        tls,
        consoleDir: deps.consoleDir ?? DEFAULT_CONSOLE_DIR,
        ...(deps.consoleNow === undefined ? {} : { now: deps.consoleNow }),
      }),
    );
  }
  // One cache for the process, shared by the pages that read a theme and the
  // admin routes that change one, so a publish reaches the next render here.
  const branding =
    deps.branding ??
    createBranding({
      database: deps.database,
      logger: deps.logger,
      publicBaseUrl: deps.publicBaseUrl,
    });
  const mailLook = createMailLook({
    theme: branding.resolveMailBranding,
    log: ({ tenantId, what, error }) => {
      deps.logger.warn(
        { tenantId, what, error },
        'mail was queued without the tenant’s theme or wording, the defaults are used',
      );
    },
  });
  const messageOverrides =
    deps.messageOverrides ??
    createDatabaseMessageOverrides({ database: deps.database, logger: deps.logger });
  app.register(
    adminRoutes({
      invalidateTheme: branding.invalidateTenant,
      isThemeMessageKey,
      messageCatalogue: pageMessageCatalogue,
      messageOverrides: {
        isKnownKey: isOverridableMessageKey,
        messageProblem: overrideProblemFor,
        invalidate: messageOverrides.invalidateTenant,
      },
      themePreviewPages: THEME_PREVIEW_PAGES,
      database: deps.database,
      ownerDatabase: deps.ownerDatabase,
      logger: deps.logger,
      cursorKey: deps.kek,
      kek: deps.kek,
      consoleBaseUrl: deps.consoleBaseUrl,
      consoleClientJwks: deps.consoleKeys?.jwks,
      trustProxy: deps.trustProxy ?? false,
      claimMappers,
      allowPrivateSmtpHosts: deps.allowPrivateSmtpHosts ?? false,
      deploymentSmtp: deps.deploymentSmtp ?? false,
      outboxMaxAttempts: deps.outboxMaxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS,
      retireResetLinks: (tx, subjectId) =>
        actionTokenRepository(tx).invalidateOutstandingPasswordLinks(subjectId),
      resolveMailLook: mailLook,
      sendAccountLink: async (tx, request) => {
        if (deps.publicBaseUrl === undefined) return 'unavailable';
        const tenant = {
          ...request,
          issuerBase: deps.publicBaseUrl,
          now: () => systemClock.now(),
          resolveMailLook: mailLook,
        };
        if (request.kind === 'reset_password') await enqueueResetLink(tx, tenant, request);
        else if (request.kind === 'verify_email')
          await enqueueVerificationLink(tx, tenant, request);
        else await enqueueActionsLink(tx, tenant, request, request);
        return 'queued';
      },
    }),
  );
  app.register(
    oidcRoutes({
      resolveBranding: branding.resolveBranding,
      resolveOverrides: messageOverrides.resolveOverrides,
      database: deps.database,
      ownerDatabase: deps.ownerDatabase,
      kek: deps.kek,
      clientSecretLimiter,
      auditRefusalBudget: auditRefusalBudget(() => new Date()),
      clientKeySet: privateKeyJwtKeySet,
      claimMappers,
      tls,
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
  const findHeldSignIn = findHeldSignInIn(deps.database, tls);
  const mailGate = deps.mailGate ?? createMailGate(() => systemClock.now());

  const themed = {
    resolveBranding: branding.resolveBranding,
    resolveMailLook: mailLook,
    resolveOverrides: messageOverrides.resolveOverrides,
    isClientOfTenant: branding.isClientOfTenant,
  };

  registerActionTokenRoute(app, {
    ...themed,
    database: deps.database,
    findHeldSignIn,
    now: () => systemClock.now(),
    findTaken,
    lockAddress: (tx, tenantId, email) => lockEmailForCreation(tx, tenantId, email),
    endAccess: (tx, tenant, subjectId, request) =>
      endAllAccess(
        tx,
        { kek: deps.kek },
        {
          tenantId: tenant.id,
          subjectId,
          now: systemClock.now(),
          issuer: tenantIssuerFor(request, tenant.name),
        },
      ),
    proveAddress: async (tx, subjectId, mailedTo) => {
      if (mailedTo === null) return null;
      if (!(await userRepository(tx).claimSelfRegistered(subjectId, mailedTo))) return null;
      return credentialRepository(tx).deleteSecondFactors(subjectId);
    },
    createVerifiedAccount,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    // A subject an administrator created has no password until a link gives
    // it its first, the way `POST …/subjects/:id/password` creates one.
    setPassword: async (tx, subjectId, password) => {
      const credentials = credentialRepository(tx);
      const hash = await hashUserPassword(password);
      if ((await credentials.passwordFor(subjectId)) !== null) {
        await credentials.setPassword(subjectId, hash);
        return;
      }
      const subject = await subjectRepository(tx).byId(subjectId);
      if (subject === null) throw new Error(`no subject ${subjectId}`);
      await credentials.insert({
        tenantId: subject.tenantId,
        subjectId,
        type: 'password',
        secret: { kind: 'password', hash },
      });
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
      return (await verifyUserPassword(current, candidate)) ? [REUSED_PASSWORD] : [];
    },
    clearPasswordUpdateAction: (tx, subjectId) =>
      requiredActionRepository(tx).complete(subjectId, 'update-password'),
    addRequiredActions: async (tx, tenantId, subjectId, actions) => {
      for (const action of actions) {
        await requiredActionRepository(tx).add(tenantId, subjectId, action);
      }
    },
  });

  registerRegistrationRoute(app, {
    ...themed,
    database: deps.database,
    findHeldSignIn,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    now: () => systemClock.now(),
    createAccount,
    lockAddress: lockEmailForCreation,
    findTaken,
    hashPassword: hashUserPassword,
    isEmailAddress,
    mailGate,
    evaluatePassword,
  });

  registerResetPasswordRoute(app, {
    ...themed,
    database: deps.database,
    findHeldSignIn,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    now: () => systemClock.now(),
    mailGate,
    findByEmail: async (tx, email) => {
      const users = userRepository(tx);
      const holder = await users.holderOfEmail(email);
      const user = holder === null ? null : await users.bySubjectId(holder);
      return user?.email == null
        ? null
        : { subjectId: user.subjectId, email: user.email, locale: user.locale };
    },
  });

  return app;
}
