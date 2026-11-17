import { listTermsAcceptancesQuerySchema, type TermsAcceptance } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { listTermsAcceptances, type ListedAcceptance } from '#/usecase/terms-acceptances';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface TermsAcceptancesRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
}

function wireShape(view: ListedAcceptance): TermsAcceptance {
  return { version: view.version, accepted_at: view.acceptedAt.toISOString() };
}

export function listTermsAcceptancesHandler(deps: TermsAcceptancesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET terms-acceptances route received no :id');
    }

    const query = listTermsAcceptancesQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listTermsAcceptances(tx, {
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
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());

    const items = outcome.items.map(wireShape);
    if (outcome.next === null) return reply.code(200).send({ items });

    const nextUrl = nextPageUrl(
      `/admin/tenants/${request.params.tenant ?? ''}/subjects/${id}/terms-acceptances`,
      { ...query, limit, cursor: outcome.next },
    );
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}
