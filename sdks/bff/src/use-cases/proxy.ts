import { accessTokenFor } from '#/services/access-token';
import { upstreamRequestHeaders } from '#/services/proxy-headers';
import { planProxy } from '#/services/proxy-route';
import type { Browser } from '#/repository/browser';
import type { Upstreams } from '#/repository/upstream';
import type { BffConfig } from '#/services/config';
import type { SessionAccess } from '#/use-cases/session-access';
import type { Handler } from '#/types';

// Calls an allowlisted upstream for a signed-in browser with the session's
// access token, renewed first when it is about to expire. The upstream's answer
// comes back as it is, a redirect included.
export function createProxy(
  browser: Browser,
  access: SessionAccess,
  upstreams: Upstreams,
  config: BffConfig,
): Handler {
  return async (request) => {
    const { pathname, search } = new URL(request.url);
    const route = planProxy(
      {
        method: request.method,
        customHeader: request.headers.get('x-odudu-bff'),
        origin: request.headers.get('origin'),
        pathname,
        search,
      },
      config,
    );
    if (route.kind !== 'target') return browser.proxyRefused(route);
    const usable = await access.usable(request);
    if (usable.kind !== 'session') return browser.noSession(usable.kind);
    const token = accessTokenFor(usable.session.tokens, route.upstream);
    if (token.kind !== 'token') return browser.noToken(token.kind);
    return browser.upstreamAnswer(
      await upstreams.forward({
        url: route.url,
        method: request.method,
        headers: upstreamRequestHeaders(request.headers, token.value),
        body: request.body,
        signal: request.signal,
      }),
    );
  };
}
