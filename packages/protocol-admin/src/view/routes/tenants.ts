import { createTenantRequestSchema, type Tenant } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit } from '#/service/cursor';
import { createTenant, listTenants, type Audit, type TenantRecord } from '#/usecase/tenants';
import { problem, sendProblem, type Problem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface TenantsRouteDeps {
  readonly database: Database;
  readonly ownerDatabase: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
}

function toWireTenant(record: TenantRecord): Tenant {
  return {
    id: record.id,
    name: record.name,
    display_name: record.displayName,
    enabled: record.enabled,
    created_at: record.createdAt.toISOString(),
  };
}

// No route in `ADMIN_ROUTES` attaches a Fastify querystring schema, so
// `request.query`'s shape is read defensively rather than cast.
function stringParam(query: unknown, name: string): string | undefined {
  if (typeof query !== 'object' || query === null) return undefined;
  const value = (query as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function badRequest(detail: string): Problem {
  return problem(400, 'about:blank', 'Bad Request', detail);
}

export function createTenantHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal) => {
    const parsed = createTenantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(reply, request, badRequest(parsed.error.message));
    }

    const outcome = await createTenant(
      { ownerDatabase: deps.ownerDatabase, database: deps.database, audit: deps.audit },
      {
        name: parsed.data.name,
        displayName: parsed.data.display_name,
        actorSubjectId: principal.subjectId,
      },
    );

    if (outcome.kind === 'name_refused') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank',
          'Conflict',
          `the name ${JSON.stringify(parsed.data.name)} is reserved`,
        ),
      );
    }

    return reply.code(201).send(toWireTenant(outcome.tenant));
  };
}

export function listTenantsHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    let limit: number;
    try {
      limit = coerceLimit(stringParam(request.query, 'limit'));
    } catch {
      return sendProblem(reply, request, badRequest('limit must be a positive integer'));
    }

    // Listing the collection is inherently cross-tenant, so it reads
    // through the owner connection — the same bypass `createTenant` and
    // `tenantLookupRepository` (@odudu/protocol-oidc) use — never the
    // RLS-scoped one, which would see no `app.tenant_id` to filter by.
    const outcome = await listTenants(deps.ownerDatabase, {
      limit,
      cursor: stringParam(request.query, 'cursor'),
      cursorKey: deps.cursorKey,
      tenantId: targetTenantId,
    });
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, badRequest('cursor is invalid or expired'));
    }

    const items = outcome.items.map(toWireTenant);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = `/admin/tenants?limit=${String(limit)}&cursor=${encodeURIComponent(outcome.next)}`;
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}
