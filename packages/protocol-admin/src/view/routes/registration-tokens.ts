import {
  listRegistrationTokensQuerySchema,
  mintRegistrationTokenRequestSchema,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  listRegistrationTokens,
  mintRegistrationToken,
  revokeRegistrationToken,
  type Audit,
} from '#/usecase/registration-tokens';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface RegistrationTokensRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
}

export function listRegistrationTokensHandler(
  deps: RegistrationTokensRouteDeps,
): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listRegistrationTokensQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: registration-tokens route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listRegistrationTokens(tx, {
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
    }

    if (outcome.next === null) {
      return reply.code(200).send({ items: outcome.items });
    }
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/registration-tokens`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function mintRegistrationTokenHandler(deps: RegistrationTokensRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = mintRegistrationTokenRequestSchema.parse(request.body);

    const { minted, etag } = await adminTx(deps.database, request, targetTenantId, (tx) =>
      mintRegistrationToken(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          uses: body.uses,
          ttlSeconds: body.ttl_seconds,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    reply.header('etag', etag);
    return reply.code(201).send(minted);
  };
}

export function revokeRegistrationTokenHandler(
  deps: RegistrationTokensRouteDeps,
): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE registration-tokens route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeRegistrationToken(
        tx,
        { audit: deps.audit },
        {
          tokenId: id,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no registration token ${id}`),
        );
      case 'deleted':
        return reply.code(204).send();
    }
  };
}
