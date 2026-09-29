import { type ListLogoutDeliveriesQuery, type LogoutDelivery } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { backchannelLogoutDeliveries, BACKCHANNEL_LOGOUT_MAX_ATTEMPTS } from '@odudu/protocol-oidc';
import { and, desc, eq, gte, isNotNull, isNull, lt, type SQL } from 'drizzle-orm';
import { type IdPageOutcome } from '#/usecase/id-page';
import { olderThan, recentPage, resumeBefore } from '#/usecase/recent-page';

const table = backchannelLogoutDeliveries;

export interface ListLogoutDeliveriesInput {
  readonly tenantId: string;
  readonly clientDbId: string;
  readonly status?: ListLogoutDeliveriesQuery['status'];
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

// `failed` is what `send-logouts` stops offering: every attempt spent and
// still undelivered (BACKCHANNEL_LOGOUT_MAX_ATTEMPTS, @odudu/protocol-oidc).
function statusCondition(status: LogoutDelivery['status']): SQL | undefined {
  switch (status) {
    case 'delivered':
      return isNotNull(table.deliveredAt);
    case 'failed':
      return and(isNull(table.deliveredAt), gte(table.attempts, BACKCHANNEL_LOGOUT_MAX_ATTEMPTS));
    case 'pending':
      return and(isNull(table.deliveredAt), lt(table.attempts, BACKCHANNEL_LOGOUT_MAX_ATTEMPTS));
  }
}

function statusOf(row: { deliveredAt: Date | null; attempts: number }): LogoutDelivery['status'] {
  if (row.deliveredAt !== null) return 'delivered';
  return row.attempts >= BACKCHANNEL_LOGOUT_MAX_ATTEMPTS ? 'failed' : 'pending';
}

/** One client's deliveries, most recent first, never the Logout Token itself. */
export async function listLogoutDeliveries(
  tx: TenantScopedDatabase,
  input: ListLogoutDeliveriesInput,
): Promise<{ kind: 'not_found' } | IdPageOutcome<LogoutDelivery>> {
  const client = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientDbId));
  if (client.length === 0) return { kind: 'not_found' };
  const request = {
    collection: 'logout-deliveries',
    tenantId: input.tenantId,
    filters: { client: input.clientDbId, status: input.status },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeBefore(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };

  const rows = await tx
    .select({
      id: table.id,
      sessionId: table.sessionId,
      endpoint: table.endpoint,
      attempts: table.attempts,
      lastError: table.lastError,
      createdAt: table.createdAt,
      nextAttemptAt: table.nextAttemptAt,
      deliveredAt: table.deliveredAt,
    })
    .from(table)
    .where(
      and(
        eq(table.clientId, input.clientDbId),
        input.status === undefined ? undefined : statusCondition(input.status),
        resume.before === undefined
          ? undefined
          : olderThan(table.createdAt, table.id, resume.before),
      ),
    )
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(input.limit + 1);

  const page = recentPage(request, rows);
  if (page.kind !== 'ok') return page;
  return {
    ...page,
    items: page.items.map((row) => ({
      id: row.id,
      session_id: row.sessionId,
      endpoint: row.endpoint,
      status: statusOf(row),
      attempts: row.attempts,
      last_error: row.lastError,
      created_at: row.createdAt.toISOString(),
      next_attempt_at: row.nextAttemptAt.toISOString(),
      delivered_at: row.deliveredAt?.toISOString() ?? null,
    })),
  };
}
