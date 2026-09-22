import {
  bypassesRowLevelSecurity,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { OduduError, type Logger } from '@odudu/kernel';
import { outboxRepository } from '#/repository/outbox';
import { type EmailSender } from '#/service/sender';
import { type OutboxMessage } from '#/schema/outbox';

/**
 * How long a claimed message stays invisible to other senders. It bounds
 * what a process killed between the claim and the send costs: the message
 * waits this long and is then offered again. Comfortably longer than an
 * SMTP attempt and shorter than any retry window an operator would notice.
 */
export const OUTBOX_CLAIM_LEASE_SECONDS = 300;

export interface SendPendingDeps {
  /** The serving, row-level-security-constrained connection: every claim and write. */
  readonly database: DatabaseHandle;
  /**
   * The owner connection, for one thing: listing the tenants to visit. The
   * outbox is scoped by `app.tenant_id`, and the tenant ids are what a tenant
   * context would have to be built from, so the queue cannot be read to
   * find out whose mail is in it (ADR 0009's amendment of 2026-09-13).
   */
  readonly ownerDatabase: DatabaseHandle;
  readonly sender: EmailSender;
  readonly log?: Logger;
}

export interface SendPendingOptions {
  /** Messages claimed per tenant per pass. */
  readonly batchSize: number;
  /** Attempts after which a message is left for an operator to read. */
  readonly maxAttempts: number;
  /** The first retry's delay; each further attempt doubles it. */
  readonly retryBackoffSeconds: number;
}

/**
 * Why a pass did nothing, distinct from a report of zeros: "sent nothing"
 * and "found no tenant to look at" are different facts, and a scheduled job
 * that conflates them reports success for work nobody did.
 */
export type SendPendingOutcome =
  | { readonly ran: false; readonly reason: 'no tenant was enumerated' }
  | { readonly ran: true; readonly sent: number; readonly failed: number };

/** Doubling from the first retry, bounded by `maxAttempts` rather than a ceiling. */
export function retryDelaySeconds(options: SendPendingOptions, attempts: number): number {
  return options.retryBackoffSeconds * 2 ** Math.max(attempts - 1, 0);
}

// Bounded, because it is stored: a transport that answers with a page of
// diagnostics would otherwise put all of it in a column an operator reads
// one line of.
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

// Both halves of the claim's scoping, checked rather than hoped for. A
// listing role without the escape reads zero tenants from a table carrying
// FORCE ROW LEVEL SECURITY, and the queue then drains never, with nothing
// to say so; a serving role *with* the escape claims every tenant's messages
// under one tenant's context, and writes the results back as that tenant's.
async function assertRolesAreRight(deps: SendPendingDeps): Promise<void> {
  if (!(await bypassesRowLevelSecurity(deps.ownerDatabase))) {
    throw new OduduError(
      'outbox_cannot_enumerate_tenants',
      'the outbox sender must list tenants on a connection that bypasses row-level security; ' +
        'ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  if (await bypassesRowLevelSecurity(deps.database)) {
    throw new OduduError(
      'outbox_serving_role_bypasses_rls',
      'the outbox sender claims under the tenant policy, so its serving connection must be ' +
        'subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role',
    );
  }
}

/**
 * `duplicate` is a message another sender recorded first: the transport
 * accepted it, but this pass is not the one that delivered it, and counting
 * it as sent would inflate every report where two senders overlap.
 */
type Delivery = 'sent' | 'failed' | 'duplicate';

async function deliver(
  deps: SendPendingDeps,
  tenantId: string,
  message: OutboxMessage,
  now: Date,
  options: SendPendingOptions,
): Promise<Delivery> {
  const write = async <T>(fn: (tx: TenantScopedDatabase) => Promise<T>): Promise<T> =>
    withTenant(deps.database.db, tenantId, fn);

  try {
    await deps.sender.send({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (err) {
    const retryAt = new Date(now.getTime() + retryDelaySeconds(options, message.attempts) * 1000);
    await write(async (tx) => {
      await outboxRepository(tx).markFailed(message.id, describeError(err), retryAt);
    });
    deps.log?.warn(
      { err, messageId: message.id, attempts: message.attempts },
      message.attempts >= options.maxAttempts
        ? 'outbox message failed for the last time and is kept for an operator to read'
        : 'outbox message failed and will be retried',
    );
    return 'failed';
  }

  const recorded = await write((tx) => outboxRepository(tx).markSent(message.id, now));
  return recorded ? 'sent' : 'duplicate';
}

/**
 * Hands every message due for an attempt to the transport, one tenant at a
 * time. Takes its `now` as an argument and holds no timer, so it runs
 * identically from `odudu send-mail`, from the server's own schedule, and
 * from a test (ADR 0024).
 */
export async function sendPending(
  deps: SendPendingDeps,
  now: Date,
  options: SendPendingOptions,
): Promise<SendPendingOutcome> {
  await assertRolesAreRight(deps);

  const rows = await deps.ownerDatabase.db
    .select({ id: tenants.id })
    .from(tenants)
    .orderBy(tenants.id);
  // Trustworthy, after the check above: an empty list means an empty
  // database and not a filtered read.
  if (rows.length === 0) return { ran: false, reason: 'no tenant was enumerated' };

  let sent = 0;
  let failed = 0;

  for (const { id: tenantId } of rows) {
    const claimed = await withTenant(deps.database.db, tenantId, (tx) =>
      outboxRepository(tx).claimBatch({
        limit: options.batchSize,
        now,
        maxAttempts: options.maxAttempts,
        leaseSeconds: OUTBOX_CLAIM_LEASE_SECONDS,
      }),
    );

    for (const message of claimed) {
      // Per message, so one address the transport chokes on does not
      // abandon the rest of the batch. A claimed message left unresolved
      // by a throw here is offered again once its lease elapses.
      try {
        const delivery = await deliver(deps, tenantId, message, now, options);
        if (delivery === 'sent') sent += 1;
        else if (delivery === 'failed') failed += 1;
      } catch (err) {
        failed += 1;
        deps.log?.error({ err, messageId: message.id }, 'outbox message could not be resolved');
      }
    }
  }

  return { ran: true, sent, failed };
}
