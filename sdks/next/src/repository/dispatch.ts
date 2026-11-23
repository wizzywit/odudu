import { notFound } from '#/adapter/responses';
import { pathnameOf } from '#/adapter/requests';
import { routeFor, type RouteName } from '#/services/route';
import type { HandlersConfig } from '#/services/config';
import type { Handler } from '@odudu-io/bff';

// One handler for every method: the request's path picks the route, and a path
// that is none of them is a 404.
export function createDispatch(
  config: HandlersConfig,
  routes: Record<RouteName, Handler>,
): Handler {
  return (request) => {
    const route = routeFor(pathnameOf(request), config.mountPath, config.proxyPath);
    return route === undefined ? Promise.resolve(notFound()) : routes[route](request);
  };
}
