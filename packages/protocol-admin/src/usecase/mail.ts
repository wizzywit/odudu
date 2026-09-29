import { type ListMailQuery, type MailMessage } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { emailOutbox } from '@odudu/email';
import { and, desc, gte, isNotNull, isNull, lt, type SQL } from 'drizzle-orm';
import { type IdPageOutcome } from '#/usecase/id-page';
import { olderThan, recentPage, resumeBefore } from '#/usecase/recent-page';

export interface ListMailInput {
  readonly tenantId: string;
  readonly status?: ListMailQuery['status'];
  /** Whether the caller may read subjects, and so their addresses. */
  readonly revealRecipients: boolean;
  /** `ODUDU_OUTBOX_MAX_ATTEMPTS`: past it, the sender offers a message no more. */
  readonly maxAttempts: number;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

function statusCondition(status: MailMessage['status'], maxAttempts: number): SQL | undefined {
  const unsent = isNull(emailOutbox.sentAt);
  switch (status) {
    case 'sent':
      return isNotNull(emailOutbox.sentAt);
    case 'failed':
      return and(unsent, gte(emailOutbox.attempts, maxAttempts));
    case 'retrying':
      return and(unsent, lt(emailOutbox.attempts, maxAttempts), isNotNull(emailOutbox.lastError));
    case 'queued':
      return and(unsent, lt(emailOutbox.attempts, maxAttempts), isNull(emailOutbox.lastError));
  }
}

function statusOf(
  row: { sentAt: Date | null; attempts: number; lastError: string | null },
  maxAttempts: number,
): MailMessage['status'] {
  if (row.sentAt !== null) return 'sent';
  if (row.attempts >= maxAttempts) return 'failed';
  return row.lastError === null ? 'queued' : 'retrying';
}

// The local part cut to its first character: enough to tell two messages
// apart in a list, not enough to address one.
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

export interface MailView extends MailMessage {
  readonly createdAt: Date;
}

// Never the body or the subject line's link: the body is what a recipient
// signs in with. A relay's error can quote the recipient back, so a masked
// listing masks it there too.
export async function listMail(
  tx: TenantScopedDatabase,
  input: ListMailInput,
): Promise<IdPageOutcome<MailMessage>> {
  const request = {
    collection: 'mail',
    tenantId: input.tenantId,
    filters: { status: input.status },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeBefore(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };

  const rows = await tx
    .select({
      id: emailOutbox.id,
      to: emailOutbox.toAddress,
      subject: emailOutbox.subject,
      attempts: emailOutbox.attempts,
      lastError: emailOutbox.lastError,
      createdAt: emailOutbox.createdAt,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .where(
      and(
        input.status === undefined ? undefined : statusCondition(input.status, input.maxAttempts),
        resume.before === undefined
          ? undefined
          : olderThan(emailOutbox.createdAt, emailOutbox.id, resume.before),
      ),
    )
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(input.limit + 1);

  const page = recentPage(request, rows);
  if (page.kind !== 'ok') return page;
  return {
    ...page,
    items: page.items.map((row) => {
      const to = input.revealRecipients ? row.to : maskAddress(row.to);
      return {
        id: row.id,
        to,
        to_masked: !input.revealRecipients,
        subject: row.subject,
        status: statusOf(row, input.maxAttempts),
        attempts: row.attempts,
        last_error: row.lastError === null ? null : row.lastError.replaceAll(row.to, to),
        created_at: row.createdAt.toISOString(),
        next_attempt_at: row.nextAttemptAt.toISOString(),
        sent_at: row.sentAt?.toISOString() ?? null,
      };
    }),
  };
}
