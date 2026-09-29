import {
  amendTenantRequestSchema,
  createTenantRequestSchema,
  deleteTenantQuerySchema,
  listTenantsQuerySchema,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { SYSTEM_TENANT_ID, TENANT_NAME_RULE } from '@odudu/domain-tenant';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  amendTenant,
  createTenant,
  deleteTenantRows,
  recordTenantDeletion,
  listTenants,
  readTenant,
  tenantWireShape,
  type Audit,
} from '#/usecase/tenants';
import { type EndDisabledTenantSessionsDeps } from '#/usecase/end-sessions';
import { cursorProblem, fieldProblem, problem, queryProblem, sendProblem } from '#/view/problem';
import { adminTx, adminTxThen } from '#/view/routes/admin-tx';
import { endSessionsAfterDisable } from '#/view/routes/disabled-tenant-sessions';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface TenantsRouteDeps {
  readonly database: Database;
  readonly ownerDatabase: Database;
  readonly cursorKey: Uint8Array;
  readonly kek: Uint8Array;
  readonly audit: Audit;
  readonly consoleBaseUrl?: string | undefined;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
  readonly sessionsAudit: EndDisabledTenantSessionsDeps['audit'];
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
          fieldProblem([{ path: outcome.field, message: outcome.reason }]),
        );
      case 'invalid_value':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            [{ path: outcome.field, message: outcome.description }],
            outcome.description,
          ),
        );
      case 'system_tenant_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'precondition_failed':
        return sendProblem(
          reply,
          request,
          problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
        );
      case 'ok': {
        if (values.enabled === false) {
          const failed = await endSessionsAfterDisable(deps, request, principal, targetTenantId);
          if (failed !== null) return sendProblem(reply, request, failed);
        }
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.tenant);
      }
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
      {
        database: deps.database,
        kek: deps.kek,
        audit: deps.audit,
        consoleBaseUrl: deps.consoleBaseUrl,
      },
      {
        name: body.name,
        displayName: body.display_name,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      },
      requestContextFrom(request),
    );

    if (outcome.kind === 'name_invalid') {
      return sendProblem(
        reply,
        request,
        fieldProblem([{ path: 'name', message: TENANT_NAME_RULE }], TENANT_NAME_RULE),
      );
    }

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

    const tenant = tenantWireShape(outcome.tenant);
    reply.header('etag', etagOf(tenant));
    return reply.code(201).send(tenant);
  };
}

export function listTenantsHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    // ADMIN_ROUTES' `querystringSchema` already validated each parameter's
    // shape (coerceTypes turns "10" into 10) but refuses no `limit` above
    // MAX_LIMIT — an over-large page size is coerced down, not rejected
    // (design spec §9), by coerceLimit alone. The one-search-field
    // refinement has no JSON Schema form, so it is only enforced here.
    const parsed = listTenantsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendProblem(reply, request, queryProblem(parsed.error));
    }
    const query = parsed.data;
    const { cursor, limit: requestedLimit, ...filters } = query;
    const limit = coerceLimit(requestedLimit === undefined ? undefined : String(requestedLimit));

    // Listing the collection is inherently cross-tenant, so it reads
    // through the owner connection — the same bypass `createTenant` and
    // `tenantLookupRepository` (@odudu/protocol-oidc) use — never the
    // RLS-scoped one, which would see no `app.tenant_id` to filter by.
    const outcome = await listTenants(deps.ownerDatabase, {
      limit,
      cursor,
      cursorKey: deps.cursorKey,
      tenantId: targetTenantId,
      filters,
    });
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
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

export function deleteTenantHandler(deps: TenantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const query = deleteTenantQuerySchema.parse(request.query);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const input = {
      tenantId: targetTenantId,
      now: deps.now(),
      confirm: query.confirm,
      callerCapabilities,
      actorSubjectId: principal.subjectId,
      actorTenantId: principal.issuerTenantId,
      actorClientId: principal.clientDbId,
    };
    const outcome = await adminTxThen(
      deps.database,
      request,
      [targetTenantId, SYSTEM_TENANT_ID],
      (tx) => deleteTenantRows(tx, input),
      (tx, deleted) => recordTenantDeletion(tx, { audit: deps.audit }, input, deleted),
    );
    switch (outcome.kind) {
      case 'deleted':
        return reply.code(204).send();
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'confirm_mismatch':
        return sendProblem(
          reply,
          request,
          fieldProblem([
            { path: 'confirm', message: `must be the tenant\u2019s own name, ${outcome.name}` },
          ]),
        );
      case 'system_tenant_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'enabled':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#tenant-enabled',
            'Conflict',
            `${outcome.name} is enabled: disable it first, which ends its sessions and tells their relying parties`,
          ),
        );
      case 'sessions_live':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#sessions-live',
            'Conflict',
            `sessions still live: ${String(outcome.live)}; disable ${outcome.name} again to end them and tell their relying parties`,
          ),
        );
      case 'logout_pending':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#logout-deliveries-pending',
            'Conflict',
            `Back-Channel Logout Tokens still to be sent: ${String(outcome.pending)}; deleting the tenant would discard them`,
          ),
        );
      case 'ceiling':
        return sendProblem(
          reply,
          request,
          problem(
            403,
            'about:blank',
            'Forbidden',
            `the tenant\u2019s subjects hold what the caller does not: ${outcome.requested.join(', ')}`,
          ),
        );
    }
  };
}
