import { type TenantScopedDatabase } from '@odudu/db';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { cibaRequests, type CibaRequestRecord } from '#/schema/ciba-requests';

export type { CibaRequestRecord } from '#/schema/ciba-requests';

export interface NewCibaRequest {
  id: string;
  tenantId: string;
  authReqHash: string;
  clientId: string;
  subjectId: string | null;
  approvalId: string | null;
  hintDigest: string;
  scope: string;
  bindingMessage: string | null;
  requestedExpiry: number | null;
  expiresAt: Date;
}

// The interval a client is told to wait never grows past this, however often
// it polls early.
export const MAX_POLL_INTERVAL_SECONDS = 300;
export const POLL_INTERVAL_STEP_SECONDS = 5;

export function cibaRequestRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewCibaRequest): Promise<CibaRequestRecord> {
      const rows = await tx.insert(cibaRequests).values(input).returning();
      const row = rows[0];
      if (row === undefined) throw new Error('insert into ciba_requests returned no row');
      return row;
    },

    async byHash(authReqHash: string): Promise<CibaRequestRecord | null> {
      const rows = await tx
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqHash, authReqHash));
      return rows[0] ?? null;
    },

    // The request an approval was made for: what the person is shown beside it.
    async byApprovalId(approvalId: string): Promise<CibaRequestRecord | null> {
      const rows = await tx
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.approvalId, approvalId));
      return rows[0] ?? null;
    },

    // The requests a client holds for one hint that have not expired, whether
    // or not the hint named anyone: what the visible limit counts.
    async liveCountFor(clientId: string, hintDigest: string, now: Date): Promise<number> {
      const rows = await tx
        .select({ n: count() })
        .from(cibaRequests)
        .where(
          and(
            eq(cibaRequests.clientId, clientId),
            eq(cibaRequests.hintDigest, hintDigest),
            gt(cibaRequests.expiresAt, now),
          ),
        );
      return rows[0]?.n ?? 0;
    },

    // Records a poll in one statement and says whether it came before the
    // interval allowed, in which case the interval is raised. Row-locked, so
    // two polls arriving together are judged one after the other.
    async recordPoll(id: string, now: Date): Promise<'on_time' | 'early' | null> {
      const rows = await tx.execute<{ early: boolean }>(sql`
        WITH prior AS (
          SELECT id, interval_seconds,
                 (last_polled_at IS NOT NULL
                  AND ${now.toISOString()}::timestamptz
                      < last_polled_at + make_interval(secs => interval_seconds)) AS early
            FROM ciba_requests
           WHERE id = ${id}
             FOR UPDATE)
        UPDATE ciba_requests r
           SET last_polled_at = ${now.toISOString()}::timestamptz,
               interval_seconds = CASE WHEN prior.early
                 THEN LEAST(prior.interval_seconds + ${POLL_INTERVAL_STEP_SECONDS},
                            ${MAX_POLL_INTERVAL_SECONDS})
                 ELSE prior.interval_seconds END
          FROM prior
         WHERE r.id = prior.id
        RETURNING prior.early AS early
      `);
      const row = rows[0];
      if (row === undefined) return null;
      return row.early ? 'early' : 'on_time';
    },
  };
}
