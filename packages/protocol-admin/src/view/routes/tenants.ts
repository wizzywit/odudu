import { createTenantRequestSchema, cursorQuerySchema, type Tenant } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit } from '#/service/cursor';
import { createTenant, listTenants, type Audit, type TenantRecord } from '#/usecase/tenants';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface TenantsRouteDeps {
  readonly database: Database;
  readonly ownerDatabase: Database;
  readonly cursorKey: Uint8Array;
  readonly kek: Uint8Array;
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

export function createTenantHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal) => {
    // Fastify's ajv compiler already validated `request.body` against this
    // same schema (ADMIN_ROUTES' `bodySchema`); parsing again only narrows
    // the type — it cannot fail.
    const body = createTenantRequestSchema.parse(request.body);

    const outcome = await createTenant(
      { database: deps.database, kek: deps.kek, audit: deps.audit },
      {
        name: body.name,
        displayName: body.display_name,
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
          `the name ${JSON.stringify(body.name)} is reserved`,
        ),
      );
    }

    return reply.code(201).send(toWireTenant(outcome.tenant));
  };
}

export function listTenantsHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    // Same narrowing as above: ADMIN_ROUTES' `querystringSchema` already
    // validated `limit`/`cursor`'s shape (coerceTypes turns "10" into 10),
    // but refuses none above MAX_LIMIT — an over-large page size is coerced
    // down, not rejected (design spec §9). coerceLimit is the one place
    // that clamps, so the shape it already checked is re-stated as a
    // string rather than duplicated as a second bound.
    const query = cursorQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));

    // Listing the collection is inherently cross-tenant, so it reads
    // through the owner connection — the same bypass `createTenant` and
    // `tenantLookupRepository` (@odudu/protocol-oidc) use — never the
    // RLS-scoped one, which would see no `app.tenant_id` to filter by.
    const outcome = await listTenants(deps.ownerDatabase, {
      limit,
      cursor: query.cursor,
      cursorKey: deps.cursorKey,
      tenantId: targetTenantId,
    });
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
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
