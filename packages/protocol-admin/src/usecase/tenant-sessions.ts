import { liveSessionCondition, sessions, type SessionLifespans } from '@odudu/authn-flows';
import { type CountResponse } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { users } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { tokenGrants, tokenGrantRepository } from '@odudu/protocol-oidc';
import { and, asc, count, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { isBeyond, isNotBeyond, subjectsBeyond } from '#/service/capability-ceiling';
import { COUNT_CAP, countAtMost } from '#/usecase/capped-count';
import { endSessionsWhere, TENANT_SESSIONS_END_LIMIT } from '#/usecase/end-sessions';
import { idPage, resumeAfter, type IdPageOutcome } from '#/usecase/id-page';

export interface TenantSessionView {
  readonly id: string;
  readonly subjectId: string;
  readonly username: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly remembered: boolean;
  readonly clientIds: readonly string[];
}

export interface SessionScope {
  readonly lifespans: SessionLifespans;
  readonly now: Date;
  /** A client's row id: only the sessions holding a grant through it. */
  readonly clientDbId?: string | undefined;
}

// The sessions that used a client are the ones a grant through it names,
// revoked or not: the same set Back-Channel Logout delivers to.
function scopeConditions(tx: TenantScopedDatabase, scope: SessionScope): SQL[] {
  const conditions = [liveSessionCondition(scope.lifespans, scope.now)];
  if (scope.clientDbId !== undefined) {
    const used = tx
      .select({ id: tokenGrants.sessionId })
      .from(tokenGrants)
      .where(eq(tokenGrants.clientId, scope.clientDbId));
    conditions.push(inArray(sessions.id, used));
  }
  return conditions;
}

async function clientKeysBySession(
  tx: TenantScopedDatabase,
  sessionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const bySession = new Map<string, string[]>();
  for (const target of await tokenGrantRepository(tx).clientsForSessions(sessionIds)) {
    bySession.set(target.sessionId, [
      ...(bySession.get(target.sessionId) ?? []),
      target.oauthClientId,
    ]);
  }
  return bySession;
}

export interface ListTenantSessionsInput extends SessionScope {
  readonly tenantId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

/** Every live session in the tenant, in id order, whoever holds it. */
export async function listTenantSessions(
  tx: TenantScopedDatabase,
  input: ListTenantSessionsInput,
): Promise<IdPageOutcome<TenantSessionView>> {
  const request = {
    collection: input.clientDbId === undefined ? 'tenant-sessions' : 'client-sessions',
    tenantId: input.tenantId,
    filters: { client: input.clientDbId },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeAfter(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };

  const conditions = scopeConditions(tx, input);
  if (resume.after !== undefined) conditions.push(gt(sessions.id, resume.after));
  const rows = await tx
    .select({
      id: sessions.id,
      subjectId: sessions.subjectId,
      username: users.username,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      remembered: sessions.remembered,
    })
    .from(sessions)
    .leftJoin(users, eq(users.subjectId, sessions.subjectId))
    .where(and(...conditions))
    .orderBy(asc(sessions.id))
    .limit(input.limit + 1);

  const page = idPage(request, rows);
  if (page.kind !== 'ok') return page;
  const keys = await clientKeysBySession(
    tx,
    page.items.map((row) => row.id),
  );
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      username: row.username ?? null,
      clientIds: keys.get(row.id) ?? [],
    })),
  };
}

/** Capped like every other count (`COUNT_CAP`, #/usecase/counts.ts). */
export async function countTenantSessions(
  tx: TenantScopedDatabase,
  scope: SessionScope,
  cap: number = COUNT_CAP,
): Promise<CountResponse> {
  const matching = tx
    .select({ one: sql<number>`1`.as('one') })
    .from(sessions)
    .where(and(...scopeConditions(tx, scope)))
    .orderBy(asc(sessions.id))
    .limit(cap + 1)
    .as('matching');
  const rows = await tx.select({ n: count() }).from(matching);
  const n = rows[0]?.n ?? 0;
  return { count: Math.min(n, cap), capped: n > cap };
}

export interface TenantSessionsAuditEvent {
  readonly action: 'session.end_all';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: Record<string, unknown>;
}

export { TENANT_SESSIONS_END_LIMIT };

export interface EndTenantSessionsDeps {
  readonly audit: (tx: TenantScopedDatabase, event: TenantSessionsAuditEvent) => Promise<void>;
  readonly kek: Uint8Array;
}

export interface EndTenantSessionsInput {
  readonly tenantId: string;
  /** The most sessions this call ends: `TENANT_SESSIONS_END_LIMIT` unless a test says less. */
  readonly endLimit?: number;
  /** The most the counts it reports go to: `COUNT_CAP` unless a test says less. */
  readonly countCap?: number;
  readonly lifespans: SessionLifespans;
  readonly now: Date;
  readonly issuer: string;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

// Each session through the one `endSession` a single end makes, so each has
// its grants revoked and its Back-Channel Logout Tokens queued. A session
// whose subject holds an admin capability the caller does not is left
// alone and counted instead (ADR 0040's amendment of 2026-09-30). At most
// `TENANT_SESSIONS_END_LIMIT` go per call, in id order, so no one
// transaction holds every session in a large tenant locked.
export async function endTenantSessions(
  tx: TenantScopedDatabase,
  deps: EndTenantSessionsDeps,
  input: EndTenantSessionsInput,
): Promise<{ ended: number; remaining: number; beyondCeiling: number }> {
  const live = liveSessionCondition(input.lifespans, input.now);
  const beyond = subjectsBeyond(input.callerCapabilities);
  const reachable = beyond === null ? live : and(live, isNotBeyond(sessions.subjectId, beyond));
  const ended = await endSessionsWhere(
    tx,
    deps.kek,
    input,
    reachable,
    input.endLimit ?? TENANT_SESSIONS_END_LIMIT,
  );
  const cap = input.countCap ?? COUNT_CAP;
  const remaining = await countAtMost(tx, { table: sessions, where: reachable }, cap);
  const skipped =
    beyond === null
      ? 0
      : await countAtMost(
          tx,
          {
            table: sessions,
            where: and(live, isBeyond(sessions.subjectId, beyond)),
          },
          cap,
        );

  await deps.audit(tx, {
    action: 'session.end_all',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { ended, remaining, beyond_ceiling: skipped },
  });
  return { ended, remaining, beyondCeiling: skipped };
}

/** The client a `…/clients/:id/…` route names, or null: its row id and `client_id`. */
export async function clientKeyOf(
  tx: TenantScopedDatabase,
  clientDbId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ clientId: clients.clientId })
    .from(clients)
    .where(eq(clients.id, clientDbId));
  return rows[0]?.clientId ?? null;
}
