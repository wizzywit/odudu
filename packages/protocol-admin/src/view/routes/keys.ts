import {
  createKeyRequestSchema,
  listKeysQuerySchema,
  type SigningKey,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  createKey,
  listKeys,
  promoteKey,
  retireKey,
  type Audit,
  type RetireKeyOutcome,
} from '#/usecase/keys';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface KeysRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly kek: Uint8Array;
  readonly audit: Audit;
}

export function listKeysHandler(deps: KeysRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listKeysQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: keys route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listKeys(tx, {
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
    }

    if (outcome.next === null) {
      return reply.code(200).send({ items: outcome.items });
    }
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/keys`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function createKeyHandler(deps: KeysRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createKeyRequestSchema.parse(request.body);

    const key: SigningKey = await adminTx(deps.database, request, targetTenantId, (tx) =>
      createKey(
        tx,
        { audit: deps.audit, kek: deps.kek },
        {
          tenantId: targetTenantId,
          alg: body.alg,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    return reply.code(201).send(key);
  };
}

export function promoteKeyHandler(deps: KeysRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST key promote route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      promoteKey(
        tx,
        { audit: deps.audit },
        {
          keyId: id,
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
          problem(404, 'about:blank', 'Not Found', `no signing key ${id}`),
        );
      case 'ok':
        return reply.code(200).send(outcome.key);
    }
  };
}

function retirementProblem(
  reply: FastifyReply,
  request: AdminRequest,
  id: string,
  outcome: Exclude<RetireKeyOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no signing key ${id}`),
      );
    case 'active':
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank',
          'Conflict',
          `signing key ${id} is active; promote another key first`,
        ),
      );
    case 'algorithm_needed':
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank',
          'Conflict',
          `no remaining signing key produces ${outcome.alg}, still required by ` +
            `userinfo_signed_response_alg on client(s): ${outcome.clientIds.join(', ')}`,
        ),
      );
  }
}

export function retireKeyHandler(deps: KeysRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST key retire route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      retireKey(
        tx,
        { audit: deps.audit },
        {
          keyId: id,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return retirementProblem(reply, request, id, outcome);
    }
    return reply.code(200).send(outcome.key);
  };
}
