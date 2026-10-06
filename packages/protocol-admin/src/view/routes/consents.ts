import { listConsentsQuerySchema, type Consent } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type SubjectConsent } from '@odudu/domain-tenant';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { listConsents, revokeConsent, type Audit } from '#/usecase/consents';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingProblem } from '#/view/routes/subjects';

export interface ConsentsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  /** See `SubjectsRouteDeps.callerCapabilities` — the same resolution. */
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
}

function consentWireShape(view: SubjectConsent): Consent {
  return {
    client_id: view.clientId,
    client_key: view.clientKey,
    scope_names: [...view.scopeNames],
    granted_at: view.grantedAt.toISOString(),
  };
}

export function listConsentsHandler(deps: ConsentsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET consents route received no :id');
    }

    const query = listConsentsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listConsents(tx, {
        tenantId: targetTenantId,
        subjectId: id,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
    }

    const items = outcome.items.map(consentWireShape);
    if (outcome.next === null) return reply.code(200).send({ items });

    const tenantName = request.params.tenant;
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName ?? ''}/subjects/${id}/consents`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function deleteConsentHandler(deps: ConsentsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const clientId = request.params.clientId;
    if (id === undefined || clientId === undefined) {
      throw new Error('protocol-admin: DELETE consent route received no :id/:clientId');
    }

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeConsent(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          clientId,
          now: deps.now(),
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'revoked':
        return reply.code(204).send();
    }
  };
}
