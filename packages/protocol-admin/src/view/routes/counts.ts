import {
  countClientsQuerySchema,
  countGroupsQuerySchema,
  countRolesQuerySchema,
  countScopesQuerySchema,
  countSubjectsQuerySchema,
  countTenantsQuerySchema,
  type CountResponse,
} from '@odudu/contracts/admin';
import { type Database, type TenantScopedDatabase } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { type z } from 'zod';
import {
  countClients,
  countGroups,
  countRoles,
  countScopes,
  countSubjects,
  countTenants,
} from '#/usecase/counts';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface CountsRouteDeps {
  readonly database: Database;
  readonly ownerDatabase: Database;
}

// ADMIN_ROUTES' `querystringSchema` already validated each parameter's
// shape; a one-search-field refinement has no JSON Schema form, so it is
// only enforced here, exactly as the matching list handler enforces it.
async function sendCount<Q>(
  schema: z.ZodType<Q>,
  request: AdminRequest,
  reply: FastifyReply,
  count: (filters: Q) => Promise<CountResponse>,
): Promise<FastifyReply> {
  const parsed = schema.safeParse(request.query);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'invalid query';
    return sendProblem(reply, request, problem(400, 'about:blank', 'Bad Request', detail));
  }
  return reply.code(200).send(await count(parsed.data));
}

function tenantScopedCount<Q>(
  schema: z.ZodType<Q>,
  count: (tx: TenantScopedDatabase, filters: Q) => Promise<CountResponse>,
) {
  return (deps: CountsRouteDeps): AdminRouteHandler =>
    (request, reply, _principal, targetTenantId) =>
      sendCount(schema, request, reply, (filters) =>
        adminTx(deps.database, request, targetTenantId, (tx) => count(tx, filters)),
      );
}

export const countSubjectsHandler = tenantScopedCount(countSubjectsQuerySchema, (tx, filters) =>
  countSubjects(tx, filters),
);
export const countClientsHandler = tenantScopedCount(countClientsQuerySchema, (tx, filters) =>
  countClients(tx, filters),
);
export const countRolesHandler = tenantScopedCount(countRolesQuerySchema, (tx, filters) =>
  countRoles(tx, filters),
);
export const countGroupsHandler = tenantScopedCount(countGroupsQuerySchema, (tx, filters) =>
  countGroups(tx, filters),
);
export const countScopesHandler = tenantScopedCount(countScopesQuerySchema, (tx, filters) =>
  countScopes(tx, filters),
);

// The collection is cross-tenant, so it is counted through the owner
// connection, as `listTenantsHandler` lists it.
export function countTenantsHandler(deps: CountsRouteDeps): AdminRouteHandler {
  return (request, reply) =>
    sendCount(countTenantsQuerySchema, request, reply, (filters) =>
      countTenants(deps.ownerDatabase, filters),
    );
}
