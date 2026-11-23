import { createBff, type Handler } from '@odudu-io/bff';
import { createDispatch } from '#/repository/dispatch';
import { createReturnTrip } from '#/repository/return-trip';
import { createSessionReader } from '#/repository/session-reader';
import { storeOf } from '#/repository/stores';
import { resolveConfig } from '#/services/config';
import type { RouteName } from '#/services/route';
import type { OduduHandlers, OduduHandlersOptions } from '#/types';

// The route handlers of a catch-all route, and the session read for server
// components, on one BFF. Each request's path picks the BFF route; the
// proxy's own path is below the mount path unless `proxyPath` says otherwise.
export function createOduduHandlers(options: OduduHandlersOptions): OduduHandlers {
  const config = resolveConfig(options);
  const store = storeOf(options, config);
  const bff = createBff({ ...options, store, proxyPath: config.proxyPath });
  const trip = createReturnTrip(config);
  const reader = createSessionReader(store, config.cookieName, options.deps?.now ?? Date.now);

  const routes: Record<RouteName, Handler> = {
    login: async (request) => trip.afterLogin(request, await bff.login(request)),
    callback: async (request) => trip.afterCallback(request, await bff.callback(request)),
    logout: bff.logout,
    session: bff.session,
    proxy: bff.proxy,
  };
  const dispatch = createDispatch(config, routes);

  return {
    GET: dispatch,
    POST: dispatch,
    PUT: dispatch,
    PATCH: dispatch,
    DELETE: dispatch,
    getSession: () => reader.read(),
  };
}
