import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { emailOutbox, type OutboxMessage } from '#/schema/outbox';

export interface EnqueueMessage {
  readonly tenantId: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface ClaimBatch {
  readonly limit: number;
  readonly now: Date;
  /** Attempts already spent beyond which a message is no longer offered. */
  readonly maxAttempts: number;
  /**
   * How long a claim holds a message invisible to other senders. It is what
   * a process killed between the claim and the send costs: the message
   * waits this long and is then offered again.
   */
  readonly leaseSeconds: number;
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  attempts: number;
}

export function outboxRepository(tx: TenantScopedDatabase) {
  return {
    /**
     * Written in the transaction that produced the mail, so a token the
     * database durably stored and a message nothing will ever send cannot
     * come apart. `next_attempt_at` is written rather than defaulted: every
     * other instant in this table's lifecycle — the claim's lease, a
     * failure's backoff, the delivery — is the application's clock, and a
     * row due by the database's clock instead is one a pass given an
     * instant from the application's own may find not yet due.
     */
    async enqueue(message: EnqueueMessage, now: Date = new Date()): Promise<{ id: string }> {
      const id = newId();
      await tx.insert(emailOutbox).values({
        id,
        tenantId: message.tenantId,
        toAddress: message.to,
        subject: message.subject,
        bodyText: message.text,
        bodyHtml: message.html,
        nextAttemptAt: now,
      });
      return { id };
    },

    /**
     * One statement: the rows are selected, locked and marked as attempted
     * together, so two senders never hand the same message to SMTP twice.
     * `FOR UPDATE SKIP LOCKED` rather than an advisory lock — senders that
     * meet here take different messages and both make progress, which is
     * what a queue wants and serialising them is not.
     */
    async claimBatch(input: ClaimBatch): Promise<OutboxMessage[]> {
      const rows = await tx.execute<ClaimedRow>(sql`
        UPDATE email_outbox
           SET attempts = attempts + 1,
               next_attempt_at = ${input.now.toISOString()}::timestamptz
                 + make_interval(secs => ${input.leaseSeconds}::integer)
         WHERE id IN (
           SELECT id FROM email_outbox
            WHERE sent_at IS NULL
              AND attempts < ${input.maxAttempts}::integer
              AND next_attempt_at <= ${input.now.toISOString()}::timestamptz
            ORDER BY next_attempt_at
            LIMIT ${input.limit}::integer
            FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id, to_address, subject, body_text, body_html, attempts
      `);

      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        to: row.to_address,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
        attempts: row.attempts,
      }));
    },

    /** Reports whether this call is the one that recorded the delivery. */
    async markSent(id: string, at: Date): Promise<boolean> {
      const rows = await tx
        .update(emailOutbox)
        .set({ sentAt: at, lastError: null })
        .where(and(eq(emailOutbox.id, id), isNull(emailOutbox.sentAt)))
        .returning({ id: emailOutbox.id });
      return rows.length === 1;
    },

    // The message is kept, not deleted: a queue that discarded a failure
    // would leave an operator with a user who never got their mail and
    // nothing to read about why. Retention is the reaper's
    // (apps/server/src/cli/reap.ts).
    async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
      await tx
        .update(emailOutbox)
        .set({ lastError: error, nextAttemptAt })
        .where(and(eq(emailOutbox.id, id), isNull(emailOutbox.sentAt)));
    },
  };
}
