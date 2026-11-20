import { createBrowser } from '#/repository/browser';
import { createIdentityProvider } from '#/repository/identity-provider';
import { createSessions } from '#/repository/sessions';
import { resolveConfig } from '#/services/config';
import { gate } from '#/services/gate';
import { createMemoryStore } from '#/services/memory-store';
import { remainingTtlMs, LOGIN_TTL_MS } from '#/services/session-policy';
import { createCallback } from '#/use-cases/callback';
import { createLogin } from '#/use-cases/login';
import { createLogout } from '#/use-cases/logout';
import { createSession } from '#/use-cases/session';
import { createSessionAccess } from '#/use-cases/session-access';
import type { Bff, BffOptions, Handler } from '#/types';

const CUSTOM_HEADER = 'x-odudu-bff';

export function createBff(options: BffOptions): Bff {
  const config = resolveConfig(options);
  const now = config.deps?.now ?? Date.now;
  // Without a store of the app's own, login records get a store of their own,
  // so a flood of `login` requests cannot push signed-in sessions out.
  const stores =
    options.store === undefined
      ? {
          sessions: createMemoryStore({ now }),
          logins: createMemoryStore({ idleMs: LOGIN_TTL_MS, now }),
        }
      : { sessions: options.store, logins: options.store };
  const sessions = createSessions(stores, (createdAt) =>
    remainingTtlMs(createdAt, config.sessionTtlMs, now()),
  );
  const browser = createBrowser(config);
  const identity = createIdentityProvider(config);
  const access = createSessionAccess(browser, sessions, identity, now);

  const guarded =
    (allow: 'GET' | 'POST', handler: Handler): Handler =>
    (request) => {
      const verdict = gate({
        method: request.method,
        allow,
        customHeader: request.headers.get(CUSTOM_HEADER),
        origin: request.headers.get('origin'),
        allowedOrigins: config.allowedOrigins,
      });
      return verdict === 'ok' ? handler(request) : Promise.resolve(browser.refused(verdict, allow));
    };

  return {
    login: guarded('GET', createLogin(browser, sessions, identity, now)),
    callback: guarded('GET', createCallback(browser, sessions, identity, now)),
    session: guarded('GET', createSession(browser, sessions, access)),
    logout: guarded('POST', createLogout(browser, sessions, identity)),
  };
}
