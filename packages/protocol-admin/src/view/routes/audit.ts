import { listAuditQuerySchema, type AuditEvent } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { listAudit } from '#/usecase/audit';
import { problem, sendProblem } from '#/view/problem';
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
    // Same narrowing as listGroupsHandler (#/view/routes/groups.ts):
    // ADMIN_ROUTES' `querystringSchema` already validated shape.
    const query = listAuditQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listAudit(tx, {
        tenantId: targetTenantId,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        ...(query.actor_subject_id !== undefined ? { actorSubjectId: query.actor_subject_id } : {}),
        ...(query.resource_type !== undefined ? { resourceType: query.resource_type } : {}),
        ...(query.action !== undefined ? { action: query.action } : {}),
        ...(query.outcome !== undefined ? { outcome: query.outcome } : {}),
        ...(parseDate(query.from) !== undefined ? { from: parseDate(query.from) } : {}),
        ...(parseDate(query.to) !== undefined ? { to: parseDate(query.to) } : {}),
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
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
