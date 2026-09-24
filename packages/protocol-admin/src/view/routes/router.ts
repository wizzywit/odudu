import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type Clock } from '@odudu/kernel';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
import {
  authenticateAdmin,
  type AdminPrincipal,
  type AuthenticateAdminDeps,
} from '#/usecase/authenticate-admin';
import { authorizeAdmin, type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { problem, sendProblem } from '#/view/problem';

export type AdminRequest = FastifyRequest<{ Params: { tenant: string } }>;

export type AdminRouteHandler = (
  request: AdminRequest,
  reply: FastifyReply,
  principal: AdminPrincipal,
) => FastifyReply | Promise<FastifyReply>;

/** Keyed by `"<method> <pattern>"`, exactly matching an `ADMIN_ROUTES` entry. */
export type AdminRouteHandlers = Readonly<Record<string, AdminRouteHandler>>;

function routeKey(method: string, pattern: string): string {
  return `${method} ${pattern}`;
}

function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(401, 'about:blank', 'Unauthorized'));
}

function sendForbidden(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
}

async function handleRoute(
  route: AdminRoute,
  handler: AdminRouteHandler,
  authDeps: AuthenticateAdminDeps,
  authzDeps: AuthorizeAdminDeps,
  clock: Clock,
  request: AdminRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const targetTenant = await authDeps.findTenant(request.params.tenant);
  if (targetTenant === null) return sendUnauthorized(request, reply);

  const outcome = await authenticateAdmin(authDeps, {
    authorizationHeader: request.headers.authorization,
    targetTenantName: request.params.tenant,
    targetTenantIssuer: tenantIssuerFor(request, request.params.tenant),
    systemTenantIssuer: tenantIssuerFor(request, SYSTEM_TENANT_NAME),
    now: clock.now(),
  });
  if (outcome.kind === 'unauthenticated') return sendUnauthorized(request, reply);

  const decision = await authorizeAdmin(
    authzDeps,
    outcome.principal,
    { tenantId: targetTenant.id },
    route.capability,
  );
  if (decision === 'forbidden') return sendForbidden(request, reply);

  return handler(request, reply, outcome.principal);
}

/**
 * The only place `ADMIN_ROUTES` becomes live Fastify routes. Every table
 * entry must have a handler and every handler must have a table entry —
 * either mismatch throws here, at startup, rather than leaving the table
 * and the router free to disagree at request time.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  handlers: AdminRouteHandlers,
  authDeps: AuthenticateAdminDeps,
  authzDeps: AuthorizeAdminDeps,
  clock: Clock,
): void {
  const unclaimed = new Set(Object.keys(handlers));

  for (const route of ADMIN_ROUTES) {
    const key = routeKey(route.method, route.pattern);
    const handler = handlers[key];
    if (handler === undefined) {
      throw new Error(`protocol-admin: ADMIN_ROUTES entry ${key} has no registered handler`);
    }
    unclaimed.delete(key);

    app.route<{ Params: { tenant: string } }>({
      method: route.method,
      url: route.pattern,
      handler: (request, reply) =>
        handleRoute(route, handler, authDeps, authzDeps, clock, request, reply),
    });
  }

  if (unclaimed.size > 0) {
    throw new Error(
      `protocol-admin: handler(s) registered for route(s) missing from ADMIN_ROUTES: ${[...unclaimed].join(', ')}`,
    );
  }
}
