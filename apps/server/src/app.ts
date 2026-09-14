import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { realmSettingsRepository, registerActionTokenRoute } from '@odudu/account';
import { type DatabaseHandle } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
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
   * Whether to trust `X-Forwarded-*` headers when deriving `request.ip`.
   * Defaults to `false`: with no reverse proxy in front of the server,
   * those headers are client-controlled, and `request.ip` will later feed
   * rate limiting, brute-force lockout, and audit records.
   */
  readonly trustProxy?: boolean;
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

  // getCurrentEmail and markVerified are the only points where @odudu/account
  // reaches @odudu/domain-identity's users table — injected here, at the
  // composition root, so @odudu/account itself stays free of that
  // dependency (packages/account/src/usecase/verify-email.ts explains why).
  registerActionTokenRoute(app, {
    database: deps.database,
    findRealm: (name) => realmSettingsRepository(deps.ownerDatabase.db).byName(name),
    getCurrentEmail: async (tx, subjectId) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx, subjectId) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
  });

  return app;
}
