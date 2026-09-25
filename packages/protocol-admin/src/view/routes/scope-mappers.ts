import { setScopeMappersRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import {
  readScopeMappers,
  setScopeMappers,
  type Audit,
  type MapperCatalogue,
} from '#/usecase/scope-mappers';
import { ifMatchRequired, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface ScopeMappersRouteDeps {
  readonly database: Database;
  readonly claimMappers: MapperCatalogue;
  readonly audit: Audit;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function readScopeMappersHandler(deps: ScopeMappersRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET scope mappers route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readScopeMappers(tx, deps.claimMappers, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
      );
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.mappers);
  };
}

export function setScopeMappersHandler(deps: ScopeMappersRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT scope mappers route received no :id');
    }
    const body = setScopeMappersRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setScopeMappers(
        tx,
        deps.claimMappers,
        { audit: deps.audit },
        {
          scopeId: id,
          mapperNames: body.mapper_names,
          ifMatch: ifMatchHeader(request),
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
          problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
        );
      case 'unknown_mapper':
        return sendProblem(
          reply,
          request,
          problem(
            400,
            'about:blank',
            'Bad Request',
            `unknown mapper name(s): ${outcome.names.join(', ')}; known: ${outcome.known.join(', ')}`,
          ),
        );
      case 'precondition_required':
        return sendProblem(reply, request, ifMatchRequired('a scope\u2019s claim mapper bindings'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.mappers);
    }
  };
}
