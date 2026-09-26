import {
  amendTenantRequestSchema,
  createTenantRequestSchema,
  cursorQuerySchema,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  amendTenant,
  createTenant,
  listTenants,
  readTenant,
  tenantWireShape,
  type Audit,
} from '#/usecase/tenants';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface TenantsRouteDeps {
  readonly database: Database;
  readonly ownerDatabase: Database;
  readonly cursorKey: Uint8Array;
  readonly kek: Uint8Array;
  readonly audit: Audit;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function readTenantHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readTenant(tx, targetTenantId),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.tenant);
  };
}

export function amendTenantHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const values = amendTenantRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      amendTenant(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          values,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'refused_field':
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', `${outcome.field}: ${outcome.reason}`),
        );
      case 'invalid_value':
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', outcome.description),
        );
      case 'system_tenant_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'precondition_failed':
        return sendProblem(
          reply,
          request,
          problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
        );
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.tenant);
    }
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
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      },
      requestContextFrom(request),
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

    if (outcome.kind === 'name_taken') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank',
          'Conflict',
          `the name ${JSON.stringify(body.name)} is already in use`,
        ),
      );
    }

    return reply.code(201).send(tenantWireShape(outcome.tenant));
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

    const items = outcome.items.map(tenantWireShape);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = nextPageUrl('/admin/tenants', { ...query, limit, cursor: outcome.next });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}
