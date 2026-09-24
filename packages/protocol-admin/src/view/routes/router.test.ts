import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';

// Never called: registration itself never authenticates or authorizes.
const authDeps = {} as unknown as AuthenticateAdminDeps;
const authzDeps = {} as unknown as AuthorizeAdminDeps;
const clock = { now: () => new Date(0) };
const noopHandler = () => {
  throw new Error('not called by these tests');
};

function handlersFor(routes: readonly { method: string; pattern: string }[]): AdminRouteHandlers {
  return Object.fromEntries(routes.map((r) => [`${r.method} ${r.pattern}`, noopHandler]));
}

describe('registerAdminRoutes', () => {
  it('registers exactly the routes ADMIN_ROUTES declares, and only those', async () => {
    const app = Fastify();
    registerAdminRoutes(app, handlersFor(ADMIN_ROUTES), authDeps, authzDeps, clock);
    await app.ready();

    for (const route of ADMIN_ROUTES) {
      expect(
        app.hasRoute({ method: route.method, url: route.pattern }),
        `${route.method} ${route.pattern}`,
      ).toBe(true);
    }
    expect(app.hasRoute({ method: 'DELETE', url: '/admin/tenants/:tenant/whoami' })).toBe(false);
    expect(app.hasRoute({ method: 'GET', url: '/admin/tenants/:tenant/nonexistent' })).toBe(false);
  });

  it('refuses to start when a table entry has no handler', () => {
    const app = Fastify();
    const incomplete = handlersFor(ADMIN_ROUTES.slice(1));
    expect(() => {
      registerAdminRoutes(app, incomplete, authDeps, authzDeps, clock);
    }).toThrow(/has no registered handler/u);
  });

  it('refuses to start when a handler names a route missing from the table', () => {
    const app = Fastify();
    const extra: AdminRouteHandlers = {
      ...handlersFor(ADMIN_ROUTES),
      'GET /admin/tenants/:tenant/not-a-real-route': noopHandler,
    };
    expect(() => {
      registerAdminRoutes(app, extra, authDeps, authzDeps, clock);
    }).toThrow(/missing from ADMIN_ROUTES/u);
  });
});
