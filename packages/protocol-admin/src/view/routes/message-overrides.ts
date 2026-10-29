import {
  type MessageCatalogueResponse,
  listMessageOverridesQuerySchema,
  putMessageOverrideRequestSchema,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  deleteMessageOverride,
  listMessageOverrides,
  putMessageOverride,
  type MessageOverrideDeps,
} from '#/usecase/message-overrides';
import { cursorProblem, fieldProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface MessageOverridesRouteDeps extends MessageOverrideDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  // Drops the tenant's cached overrides in this process, once a write has
  // committed.
  readonly invalidate: (tenantId: string) => void;
}

function paramsOf(request: { params: { tenant?: string; locale?: string; key?: string } }): {
  tenant: string;
  locale: string;
  key: string;
} {
  const { tenant, locale, key } = request.params;
  if (tenant === undefined || locale === undefined || key === undefined) {
    throw new Error(
      'protocol-admin: a message-overrides route received no :tenant, :locale or :key',
    );
  }
  return { tenant, locale, key };
}

export function listMessageOverridesHandler(deps: MessageOverridesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const query = listMessageOverridesQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: message-overrides route received no :tenant');
    }
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      listMessageOverrides(deps, tx, { ...query, limit, cursorKey: deps.cursorKey, tenantId }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    if (outcome.next === null) return reply.code(200).send({ items: outcome.items });
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/message-overrides`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function putMessageOverrideHandler(deps: MessageOverridesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, tenantId) => {
    const { locale, key } = paramsOf(request);
    const body = putMessageOverrideRequestSchema.parse(request.body);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      putMessageOverride(deps, tx, {
        tenantId,
        locale,
        key,
        message: body.message,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    switch (outcome.kind) {
      case 'unknown_key':
        return sendProblem(
          reply,
          request,
          fieldProblem([{ path: 'key', message: 'is not the key of any page or mail message' }]),
        );
      case 'invalid_message':
        return sendProblem(
          reply,
          request,
          fieldProblem([{ path: 'message', message: outcome.problem }]),
        );
      case 'over_bound':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#message-overrides-full',
            'Conflict',
            'the tenant already holds 500 message overrides',
          ),
        );
      case 'put':
        deps.invalidate(tenantId);
        return reply.code(200).send(outcome.override);
    }
  };
}

export function deleteMessageOverrideHandler(deps: MessageOverridesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, tenantId) => {
    const { locale, key } = paramsOf(request);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      deleteMessageOverride(deps, tx, {
        tenantId,
        locale,
        key,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }
    deps.invalidate(tenantId);
    return reply.code(204).send();
  };
}

// The same answer for every tenant and every call, so there is nothing to read.
export function messageCatalogueHandler(
  catalogue: () => MessageCatalogueResponse,
): AdminRouteHandler {
  return (_request, reply) => reply.code(200).send(catalogue());
}
