import { type DatabaseHandle } from '@odudu/db';
import { type FastifyPluginAsync } from 'fastify';
import { oduduClient } from '#/adapter/odudu-client';
import { refreshConcurrency, semaphore } from '#/service/semaphore';
import { singleFlight } from '#/service/single-flight';
import { type FreshToken } from '#/usecase/fresh-access-token';
import { registerConsoleApi } from '#/view/api';
import { registerAuthRoutes } from '#/view/routes/auth';
import { spaRoutes } from '#/view/spa';

export {
  consoleLoginRepository,
  type ConsoleLoginRecord,
  type NewConsoleLogin,
} from '#/repository/console-logins';
export {
  consoleSessionRepository,
  type ConsoleSessionRecord,
  type ConsoleSessionTokens,
  type NewConsoleSession,
} from '#/repository/console-sessions';
export { safeReturnTo } from '#/service/return-to';
export { CONSOLE_SESSION_IDLE_SECONDS } from '#/service/session-lifetime';

export interface ConsoleGatewayDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly kek: Uint8Array;
  /** `ODUDU_PUBLIC_BASE_URL`: every redirect and every in-process call is built on it. */
  readonly publicBaseUrl: string;
  /** `ODUDU_CONSOLE_DIR`: the built single-page app, read once at registration. */
  readonly consoleDir: string;
  readonly now?: () => Date;
}

// Registered encapsulated: its own `inject` still dispatches through the
// root router, so the gateway reaches the server's OIDC and admin routes
// as an ordinary client would, through their own checks.
export function consoleGateway(deps: ConsoleGatewayDeps): FastifyPluginAsync {
  const base = new URL(deps.publicBaseUrl);
  const tls = base.protocol === 'https:';
  const login = {
    database: deps.database,
    ownerDatabase: deps.ownerDatabase,
    kek: deps.kek,
    base,
  };
  const now = deps.now ?? (() => new Date());
  return (fastify) => {
    const odudu = oduduClient(fastify, base);
    fastify.register(
      (auth) => {
        registerAuthRoutes(auth, {
          login,
          callback: { ...login, odudu },
          logout: { database: deps.database, kek: deps.kek, odudu, base, tls, now },
          tls,
          now,
          origin: base.origin,
        });
        return Promise.resolve();
      },
      { prefix: '/console/auth' },
    );
    fastify.register(
      (api) => {
        registerConsoleApi(api, {
          database: deps.database,
          kek: deps.kek,
          odudu,
          refreshes: singleFlight<string, FreshToken>(),
          refreshSlots: semaphore(refreshConcurrency(deps.database.sql.options.max)),
          tls,
          now,
          origin: base.origin,
        });
        return Promise.resolve();
      },
      { prefix: '/console/api' },
    );
    fastify.register(spaRoutes(deps.consoleDir));
    return Promise.resolve();
  };
}
