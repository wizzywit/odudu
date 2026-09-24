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

// Optional: `/admin/tenants` itself carries no `:tenant` segment (see
// `targetTenantNameFor` below), so Fastify never populates this param for
// it — the type says so rather than leaving a reader to notice at runtime.
export type AdminRequest = FastifyRequest<{ Params: { tenant?: string } }>;

export type AdminRouteHandler = (
  request: AdminRequest,
  reply: FastifyReply,
  principal: AdminPrincipal,
  targetTenantId: string,
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

// A route's target tenant comes from its own path when it has one. The
// handful with no `:tenant` segment administer the tenant collection
// itself, not any one tenant's data — so their target is the system
// tenant, explicitly, rather than an absent path param read as one by
// accident. `route.pattern` (the table entry), not `request.params`,
// decides which case this is, so the two can never disagree.
function targetTenantNameFor(route: AdminRoute, params: { tenant?: string }): string {
  if (!route.pattern.includes(':tenant')) return SYSTEM_TENANT_NAME;
  const tenant = params.tenant;
  if (tenant === undefined) {
    throw new Error(`protocol-admin: route ${route.pattern} declares :tenant but received none`);
  }
  return tenant;
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
  const targetTenantName = targetTenantNameFor(route, request.params);
  const targetTenant = await authDeps.findTenant(targetTenantName);
  if (targetTenant === null) return sendUnauthorized(request, reply);

  const outcome = await authenticateAdmin(authDeps, {
    authorizationHeader: request.headers.authorization,
    targetTenantName,
    targetTenantIssuer: tenantIssuerFor(request, targetTenantName),
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

  return handler(request, reply, outcome.principal, targetTenant.id);
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

    app.route<{ Params: { tenant?: string } }>({
      method: route.method,
      url: route.pattern,
      schema: {
        ...(route.querystringSchema !== undefined ? { querystring: route.querystringSchema } : {}),
        ...(route.bodySchema !== undefined ? { body: route.bodySchema } : {}),
      },
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
