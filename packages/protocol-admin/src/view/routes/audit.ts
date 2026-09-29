import { listAuditQuerySchema, type AuditEvent } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { listAudit } from '#/usecase/audit';
import { cursorProblem, queryProblem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface AuditRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  return new Date(raw);
}

export function listAuditHandler(deps: AuditRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: GET audit route received no :tenant');
    }
    // ADMIN_ROUTES' `querystringSchema` already validated each parameter's
    // shape; the resource_id-requires-resource_type refinement has no JSON
    // Schema form, so it is only enforced here (listSubjectsHandler,
    // #/view/routes/subjects.ts, is the same pattern).
    const parsed = listAuditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendProblem(reply, request, queryProblem(parsed.error));
    }
    const query = parsed.data;
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listAudit(tx, {
        tenantId: targetTenantId,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        ...(query.event_type !== undefined ? { eventType: query.event_type } : {}),
        ...(query.actor_subject_id !== undefined ? { actorSubjectId: query.actor_subject_id } : {}),
        ...(query.resource_type !== undefined ? { resourceType: query.resource_type } : {}),
        ...(query.resource_id !== undefined ? { resourceId: query.resource_id } : {}),
        ...(query.action !== undefined ? { action: query.action } : {}),
        ...(query.outcome !== undefined ? { outcome: query.outcome } : {}),
        ...(parseDate(query.from) !== undefined ? { from: parseDate(query.from) } : {}),
        ...(parseDate(query.to) !== undefined ? { to: parseDate(query.to) } : {}),
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
    }

    const items: AuditEvent[] = [...outcome.items];
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/audit`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}
