import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import {
  realmSettingsRepository,
  registerActionTokenRoute,
  registerRegistrationRoute,
  registerResetPasswordRoute,
  type CreateAccountResult,
  type NewAccountInput,
} from '@odudu/account';
import { type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { type EmailSender } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { oidcRoutes } from '@odudu/protocol-oidc';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger as PinoLogger } from 'pino';
import { registerHealth } from '#/health';

export interface AppDeps {
  readonly database: DatabaseHandle;
  /**
   * The owner (RLS-bypassing) connection, used for one thing: resolving
   * `{realm}` from a request path before any realm context exists to scope
   * that lookup by (ADR 0009's amendment of 2026-09-13). Required rather
   * than defaulted, because on the RLS-constrained connection the lookup
   * returns zero rows unconditionally and 404s every realm forever, which
   * is indistinguishable from "no realms configured". A caller that wants
   * one connection for both passes `database` again here, as `main.ts` does.
   */
  readonly ownerDatabase: DatabaseHandle;
  /**
   * Unwraps the private half of a realm's active signing key so `/token`
   * can sign access and ID tokens — `@odudu/kernel`'s config schema already
   * decodes and length-checks `ODUDU_KEK` at the config boundary.
   */
  readonly kek: Uint8Array;
  readonly logger: PinoLogger;
  /**
   * Where a mailed link goes: address verification triggered by
   * self-registration. Required rather than defaulted for the same reason
   * `kek` is — there is no safe placeholder that would not silently drop
   * mail, and `main.ts` builds the real one from `ODUDU_SMTP_*` while a
   * test builds a capturing or in-memory one.
   */
  readonly sender: EmailSender;
  /**
   * The base a mailed verification link is built from — never derived from
   * a request, since `Host` is client-controlled (see
   * `packages/account/src/view/routes/registration.ts`). Undefined when
   * `ODUDU_PUBLIC_BASE_URL` is unset; registration then refuses to send
   * for any realm with `verify_email` on rather than guessing one.
   */
  readonly publicBaseUrl?: string;
  /**
   * Whether to trust `X-Forwarded-*` headers when deriving `request.ip`.
   * Defaults to `false`: with no reverse proxy in front of the server,
   * those headers are client-controlled, and `request.ip` will later feed
   * rate limiting, brute-force lockout, and audit records.
   */
  readonly trustProxy?: boolean;
}

// The composition-root half of self-registration: @odudu/account never
// imports @odudu/domain-identity (subjects, users, credentials) or
// @odudu/domain-authz (roles), so the actual writes are wired here, inside
// the one transaction packages/account/src/usecase/register.ts already
// opened around this call and the verify_email token issued alongside it.
async function createAccount(
  tx: RealmScopedDatabase,
  realmId: string,
  input: NewAccountInput,
): Promise<CreateAccountResult> {
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    realmId,
    username: input.username,
    email: input.email,
  });
  await credentialRepository(tx).insert({
    realmId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: await hashPassword(input.password) },
  });
  const defaults = await roleRepository(tx).defaultsForRealm();
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

  // Registered here rather than by a route: the token endpoint needs
  // form-encoded bodies and the authorization endpoint needs the session
  // cookie, and plugin registration is an app-wide concern.
  app.register(formbody);
  app.register(cookie);

  registerHealth(app, deps);
  app.register(
    oidcRoutes({ database: deps.database, ownerDatabase: deps.ownerDatabase, kek: deps.kek }),
  );

  // getCurrentEmail, markVerified and setPassword are the only points where
  // @odudu/account reaches @odudu/domain-identity's users and credentials
  // tables — injected here, at the composition root, so @odudu/account
  // itself stays free of that dependency
  // (packages/account/src/usecase/verify-email.ts explains why).
  registerActionTokenRoute(app, {
    database: deps.database,
    findRealm: (name) => realmSettingsRepository(deps.ownerDatabase.db).byName(name),
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    setPassword: async (tx, subjectId, password) => {
      await credentialRepository(tx).setPassword(subjectId, await hashPassword(password));
    },
  });

  registerRegistrationRoute(app, {
    database: deps.database,
    sender: deps.sender,
    findRealm: (name) => realmSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    createAccount,
  });

  registerResetPasswordRoute(app, {
    database: deps.database,
    sender: deps.sender,
    findRealm: (name) => realmSettingsRepository(deps.ownerDatabase.db).byName(name),
    publicBaseUrl: deps.publicBaseUrl,
    findByEmail: async (tx, email) => {
      const user = await userRepository(tx).byEmail(email);
      return user?.email == null ? null : { subjectId: user.subjectId, email: user.email };
    },
  });

  return app;
}
