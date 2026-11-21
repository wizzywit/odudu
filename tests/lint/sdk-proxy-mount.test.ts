import { describe, expect, it } from 'vitest';
import { routesOf } from '../../sdks/bff/src/adapter/routes.ts';
import { createBff } from '../../sdks/bff/src/use-cases/create-bff.ts';
import { loginUrl, proxyUrl, sessionUrl } from '../../sdks/react/src/services/bff.ts';

// The React hooks build every address from one `baseUrl`; the BFF adapters
// mount the routes at the BFF's `mountPath`. They must meet.
describe('the address React builds for a BFF mounted at a path', () => {
  const options = {
    issuer: 'https://id.example/tenants/demo',
    clientId: 'web1',
    redirectUri: 'https://app.example/bff/callback',
    scope: 'openid',
  };

  it.each(['', '/bff', '/api/auth'])('is a route of the BFF mounted at %j', (mountPath) => {
    const bff = createBff({ ...options, mountPath });
    const routes = routesOf(bff, bff.mountPath).map((route) => route.path);
    expect(routes).toContain(new URL(loginUrl(mountPath), 'https://app.example').pathname);
    expect(routes).toContain(new URL(sessionUrl(mountPath), 'https://app.example').pathname);
    const proxied = new URL(proxyUrl(mountPath, 'api/v1/x'), 'https://app.example').pathname;
    expect(proxied.startsWith(`${bff.proxyPath}/`)).toBe(true);
  });

  it('follows a custom proxyPath given to both sides', () => {
    const bff = createBff({ ...options, mountPath: '/bff', proxyPath: '/api/x/proxy' });
    const proxied = new URL(proxyUrl('/bff', 'api/v1/x', bff.proxyPath), 'https://app.example')
      .pathname;
    expect(proxied.startsWith(`${bff.proxyPath}/`)).toBe(true);
  });
});
