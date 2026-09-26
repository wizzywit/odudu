import { type Database, type TenantScopedDatabase } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type Clock } from '@odudu/kernel';
import { issuerBaseFor, tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
import { paramsSchemaFor } from '#/service/path-params';
import { recordCapabilityRefused, recordForeignIssuer } from '#/usecase/access-audit';
import {
  authenticateAdmin,
  type AdminPrincipal,
  type AuthenticateAdminDeps,
} from '#/usecase/authenticate-admin';
import { authorizeAdmin, type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';

// Optional: `/admin/tenants` itself carries no `:tenant` segment (see
// `targetTenantNameFor` below), and most routes carry no `:id` segment
// either — Fastify never populates a param ADMIN_ROUTES' own pattern does
// not declare, so the type says both are absent rather than leaving a
// reader to notice at runtime.
export interface AdminRouteParams {
  readonly tenant?: string;
  readonly id?: string;
  readonly credentialId?: string;
  readonly sid?: string;
  readonly clientId?: string;
}

export type AdminRequest = FastifyRequest<{ Params: AdminRouteParams }>;

export type AdminRouteHandler = (
  request: AdminRequest,
  reply: FastifyReply,
  principal: AdminPrincipal,
  targetTenantId: string,
) => FastifyReply | Promise<FastifyReply>;

export interface AdminRouterDeps {
  readonly auth: AuthenticateAdminDeps;
  readonly authz: AuthorizeAdminDeps;
  readonly clock: Clock;
  readonly database: Database;
}

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
function targetTenantNameFor(route: AdminRoute, params: AdminRouteParams): string {
  if (!route.pattern.includes(':tenant')) return SYSTEM_TENANT_NAME;
  const tenant = params.tenant;
  if (tenant === undefined) {
    throw new Error(`protocol-admin: route ${route.pattern} declares :tenant but received none`);
  }
  return tenant;
}

// A refusal is sent whether or not its row could be written.
async function recordRefusal(
  database: Database,
  request: FastifyRequest,
  tenantId: string,
  write: (tx: TenantScopedDatabase) => Promise<void>,
): Promise<void> {
  try {
    await adminTx(database, request, tenantId, write);
  } catch (error) {
    request.log.error({ err: error, tenantId }, 'could not record a refused admin request');
  }
}

async function handleRoute(
  route: AdminRoute,
  handler: AdminRouteHandler,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const targetTenantName = targetTenantNameFor(route, request.params);
  const targetTenant = await deps.auth.findTenant(targetTenantName);
  if (targetTenant === null) {
    request.log.warn({ reason: 'unknown_tenant' }, 'admin request unauthenticated');
    return sendUnauthorized(request, reply);
  }

  const outcome = await authenticateAdmin(deps.auth, {
    authorizationHeader: request.headers.authorization,
    targetTenantName,
    targetTenantIssuer: tenantIssuerFor(request, targetTenantName),
    systemTenantIssuer: tenantIssuerFor(request, SYSTEM_TENANT_NAME),
    issuerBase: issuerBaseFor(request),
    now: deps.clock.now(),
  });
  if (outcome.kind === 'unauthenticated') {
    const foreign = outcome.foreignIssuer;
    if (outcome.foreignIssuerError !== undefined) {
      request.log.error(
        { err: outcome.foreignIssuerError, reason: outcome.reason },
        'could not resolve the issuer of a refused admin request',
      );
    } else if (foreign === undefined) {
      request.log.warn({ reason: outcome.reason }, 'admin request unauthenticated');
    } else {
      await recordRefusal(deps.database, request, targetTenant.id, (tx) =>
        recordForeignIssuer(tx, foreign),
      );
    }
    return sendUnauthorized(request, reply);
  }

  const decision = await authorizeAdmin(
    deps.authz,
    outcome.principal,
    { tenantId: targetTenant.id },
    route.capability,
  );
  if (decision.kind === 'forbidden') {
    await recordRefusal(deps.database, request, targetTenant.id, (tx) =>
      recordCapabilityRefused(tx, outcome.principal, decision.missing),
    );
    return sendForbidden(request, reply);
  }

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
  deps: AdminRouterDeps,
): void {
  const unclaimed = new Set(Object.keys(handlers));

  for (const route of ADMIN_ROUTES) {
    const key = routeKey(route.method, route.pattern);
    const handler = handlers[key];
    if (handler === undefined) {
      throw new Error(`protocol-admin: ADMIN_ROUTES entry ${key} has no registered handler`);
    }
    unclaimed.delete(key);

    const paramsSchema = paramsSchemaFor(route.pattern);
    app.route<{ Params: AdminRouteParams }>({
      method: route.method,
      url: route.pattern,
      schema: {
        ...(paramsSchema === undefined ? {} : { params: paramsSchema }),
        ...(route.querystringSchema !== undefined ? { querystring: route.querystringSchema } : {}),
        ...(route.bodySchema !== undefined ? { body: route.bodySchema } : {}),
      },
      handler: (request, reply) => handleRoute(route, handler, deps, request, reply),
    });
  }

  if (unclaimed.size > 0) {
    throw new Error(
      `protocol-admin: handler(s) registered for route(s) missing from ADMIN_ROUTES: ${[...unclaimed].join(', ')}`,
    );
  }
}
