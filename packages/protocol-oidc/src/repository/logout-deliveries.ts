import { type RealmScopedDatabase } from '@odudu/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { backchannelLogoutDeliveries, type LogoutDelivery } from '#/schema/logout-deliveries';

/** Attempts already spent beyond which a delivery is no longer offered. */
export const BACKCHANNEL_LOGOUT_MAX_ATTEMPTS = 5;

/** How long a failed delivery waits before it is offered again. */
export const BACKCHANNEL_LOGOUT_RETRY_BACKOFF_SECONDS = 60;

export interface EnqueueDelivery {
  readonly id: string;
  readonly realmId: string;
  readonly clientId: string;
  readonly endpoint: string;
  readonly logoutToken: string;
  readonly nextAttemptAt: Date;
}

export interface ClaimDue {
  readonly now: Date;
  readonly limit: number;
  /**
   * How long a claim holds a delivery invisible to other passes. It is
   * what a process killed between the claim and the send costs: the
   * delivery waits this long and is then offered again.
   */
  readonly leaseSeconds: number;
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  realm_id: string;
  client_id: string;
  endpoint: string;
  logout_token: string;
  attempts: number;
}

export function logoutDeliveryRepository(tx: RealmScopedDatabase) {
  return {
    /**
     * Written in the transaction that ends the session (the next task's
     * work), so a token the database durably stored and a delivery nothing
     * will ever send cannot come apart.
     */
    async enqueue(deliveries: readonly EnqueueDelivery[]): Promise<void> {
      if (deliveries.length === 0) {
        return;
      }
      await tx.insert(backchannelLogoutDeliveries).values(
        deliveries.map((delivery) => ({
          id: delivery.id,
          realmId: delivery.realmId,
          clientId: delivery.clientId,
          endpoint: delivery.endpoint,
          logoutToken: delivery.logoutToken,
          nextAttemptAt: delivery.nextAttemptAt,
        })),
      );
    },

    /**
     * One statement: the rows are selected, locked and leased together, so
     * two passes never hand the same delivery to a sender twice. `FOR
     * UPDATE SKIP LOCKED` rather than blocking — a row a concurrent pass
     * already holds is skipped, not waited on, so both passes take
     * different rows and make progress. The lease is what a crash between
     * this claim and the send costs: `attempts` is spent up front, and
     * `next_attempt_at` moves out by `leaseSeconds` so nothing else offers
     * the row again before that, win or lose.
     */
    async claimDue(input: ClaimDue): Promise<LogoutDelivery[]> {
      const rows = await tx.execute<ClaimedRow>(sql`
        UPDATE backchannel_logout_deliveries
           SET attempts = attempts + 1,
               next_attempt_at = ${input.now.toISOString()}::timestamptz
                 + make_interval(secs => ${input.leaseSeconds}::integer)
         WHERE id IN (
           SELECT id FROM backchannel_logout_deliveries
            WHERE delivered_at IS NULL
              AND attempts < ${BACKCHANNEL_LOGOUT_MAX_ATTEMPTS}::integer
              AND next_attempt_at <= ${input.now.toISOString()}::timestamptz
            ORDER BY next_attempt_at
            LIMIT ${input.limit}::integer
            FOR UPDATE SKIP LOCKED)
        RETURNING id, realm_id, client_id, endpoint, logout_token, attempts
      `);

      return rows.map((row) => ({
        id: row.id,
        realmId: row.realm_id,
        clientId: row.client_id,
        endpoint: row.endpoint,
        logoutToken: row.logout_token,
        attempts: row.attempts,
      }));
    },

    /** Reports whether this call is the one that recorded the delivery. */
    async markDelivered(id: string, at: Date): Promise<boolean> {
      const rows = await tx
        .update(backchannelLogoutDeliveries)
        .set({ deliveredAt: at, lastError: null })
        .where(
          and(
            eq(backchannelLogoutDeliveries.id, id),
            isNull(backchannelLogoutDeliveries.deliveredAt),
          ),
        )
        .returning({ id: backchannelLogoutDeliveries.id });
      return rows.length === 1;
    },

    // The row is kept, not deleted: a queue that discarded a failure would
    // leave an operator with a relying party that never learned a session
    // ended and nothing to read about why. Retention is the reaper's.
    async markFailed(id: string, now: Date, error: string): Promise<void> {
      await tx
        .update(backchannelLogoutDeliveries)
        .set({
          attempts: sql`${backchannelLogoutDeliveries.attempts} + 1`,
          lastError: error,
          nextAttemptAt: new Date(now.getTime() + BACKCHANNEL_LOGOUT_RETRY_BACKOFF_SECONDS * 1000),
        })
        .where(
          and(
            eq(backchannelLogoutDeliveries.id, id),
            isNull(backchannelLogoutDeliveries.deliveredAt),
          ),
        );
    },
  };
}
