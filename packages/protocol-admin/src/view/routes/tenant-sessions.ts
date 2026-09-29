import {
  countSessionsQuerySchema,
  listTenantSessionsQuerySchema,
  type TenantSession,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { tenantIssuerFor, type TenantLookup } from '@odudu/protocol-oidc';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { lifespansOf } from '#/usecase/authenticate-admin';
import {
  clientKeyOf,
  countTenantSessions,
  endTenantSessions,
  listTenantSessions,
  type EndTenantSessionsDeps,
  type TenantSessionView,
} from '#/usecase/tenant-sessions';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface TenantSessionsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: EndTenantSessionsDeps['audit'];
  readonly kek: Uint8Array;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
  readonly findTenant: (name: string) => Promise<TenantLookup | null>;
}

function tenantSessionWireShape(view: TenantSessionView): TenantSession {
  return {
    id: view.id,
    subject_id: view.subjectId,
    username: view.username,
    created_at: view.createdAt.toISOString(),
    last_active_at: view.lastActiveAt.toISOString(),
    remembered: view.remembered,
    client_ids: [...view.clientIds],
  };
}

async function tenantOf(deps: TenantSessionsRouteDeps, request: AdminRequest) {
  const name = request.params.tenant;
  if (name === undefined) throw new Error('protocol-admin: sessions route received no :tenant');
  const tenant = await deps.findTenant(name);
  if (tenant === null) {
    throw new Error('protocol-admin: sessions route resolved a tenant router.ts already found');
  }
  return { name, lifespans: lifespansOf(tenant) };
}

function listHandler(
  deps: TenantSessionsRouteDeps,
  clientFrom: (request: AdminRequest, query: { client?: string | undefined }) => string | undefined,
  path: (tenant: string, request: AdminRequest) => string,
): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listTenantSessionsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenant = await tenantOf(deps, request);
    const clientDbId = clientFrom(request, query);

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      if (request.params.id !== undefined && (await clientKeyOf(tx, request.params.id)) === null) {
        return { kind: 'not_found' } as const;
      }
      return listTenantSessions(tx, {
        tenantId: targetTenantId,
        lifespans: tenant.lifespans,
        now: deps.now(),
        clientDbId,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      });
    });
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', 'no such client'),
      );
    }
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());

    const items = outcome.items.map(tenantSessionWireShape);
    if (outcome.next === null) return reply.code(200).send({ items });
    const nextUrl = nextPageUrl(path(tenant.name, request), {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function listTenantSessionsHandler(deps: TenantSessionsRouteDeps): AdminRouteHandler {
  return listHandler(
    deps,
    (_request, query) => query.client,
    (tenant) => `/admin/tenants/${tenant}/sessions`,
  );
}

export function listClientSessionsHandler(deps: TenantSessionsRouteDeps): AdminRouteHandler {
  return listHandler(
    deps,
    (request) => request.params.id,
    (tenant, request) => `/admin/tenants/${tenant}/clients/${request.params.id ?? ''}/sessions`,
  );
}

export function countTenantSessionsHandler(deps: TenantSessionsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = countSessionsQuerySchema.parse(request.query);
    const tenant = await tenantOf(deps, request);
    const counted = await adminTx(deps.database, request, targetTenantId, (tx) =>
      countTenantSessions(tx, {
        lifespans: tenant.lifespans,
        now: deps.now(),
        clientDbId: query.client,
      }),
    );
    return reply.code(200).send(counted);
  };
}

export function endTenantSessionsHandler(deps: TenantSessionsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const tenant = await tenantOf(deps, request);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      endTenantSessions(
        tx,
        { audit: deps.audit, kek: deps.kek },
        {
          tenantId: targetTenantId,
          lifespans: tenant.lifespans,
          now: deps.now(),
          issuer: tenantIssuerFor(request, tenant.name),
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );
    return reply.code(200).send({
      ended: outcome.ended,
      remaining: outcome.remaining,
      beyond_ceiling: outcome.beyondCeiling,
    });
  };
}
