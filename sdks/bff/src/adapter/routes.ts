import { checkPrefix } from '#/services/config';
import type { Bff, Handler } from '#/types';

export interface BffRoute {
  // `/login`, relative to the prefix, or the proxy path as it is.
  path: string;
  handler: Handler;
  // A route that takes a trailing path below it.
  below: boolean;
}

// The routes a framework adapter mounts. Each answers every method, so the
// handler's own 405 reaches the browser.
export function routesOf(bff: Bff, mount: string): BffRoute[] {
  const prefix = checkPrefix(mount);
  return [
    { path: `${prefix}/login`, handler: bff.login, below: false },
    { path: `${prefix}/callback`, handler: bff.callback, below: false },
    { path: `${prefix}/logout`, handler: bff.logout, below: false },
    { path: `${prefix}/session`, handler: bff.session, below: false },
    { path: bff.proxyPath, handler: bff.proxy, below: true },
  ];
}
