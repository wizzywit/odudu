import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { outboxRepository } from '#/repository/outbox';
import { noticeRecipient, type NoticeAddress } from '#/service/notice-recipient';
import { renderApprovalNotice } from '#/service/templates';
import { tenantMailContext, type MailLookResolver } from '#/usecase/mail-context';

export interface ApprovalNotice {
  readonly tenantId: string;
  readonly address: NoticeAddress;
  // The approval page, carrying the approval's id and nothing else.
  readonly link: string;
  // The name of the client that is asking.
  readonly agent: string;
  readonly now: Date;
  // Whether this address may be mailed again now, asked only of an address
  // that could be mailed. Over its budget, a notice is not written and runs
  // the statements an unmailable address does.
  readonly mailBudgetAllows?: ((address: string) => boolean) | undefined;
}

async function readTenant(
  tx: TenantScopedDatabase,
  input: ApprovalNotice,
  resolveMailLook: MailLookResolver | undefined,
) {
  const [tenant] = await tx
    .select({ name: tenants.name, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const name = tenant?.name ?? '';
  const mail = await tenantMailContext(tx, resolveMailLook, {
    tenantId: input.tenantId,
    tenantName: name,
  });
  return { displayName: tenant?.displayName ?? name, mail };
}

// To a verified address only, and within its mail budget: the page the link
// opens needs the person's own session, but a stranger who registered with the
// address would still learn that an agent is asking. The statements are the
// same whether or not a mail is written, because a caller that must not tell a
// known person from an unknown one runs this for both. Queued in the
// transaction that made the approval, so a rollback sends nothing.
export async function queueApprovalNotice(
  tx: TenantScopedDatabase,
  input: ApprovalNotice,
  resolveMailLook: MailLookResolver | undefined,
): Promise<'sent' | 'skipped_none'> {
  const { displayName, mail } = await readTenant(tx, input, resolveMailLook);
  const recipient = noticeRecipient(input.address.email, input.address.verified);
  if (!recipient.send || input.mailBudgetAllows?.(recipient.to) === false) {
    await outboxRepository(tx).enqueueNothing();
    return 'skipped_none';
  }
  const message = renderApprovalNotice({
    to: recipient.to,
    link: input.link,
    agent: input.agent,
    tenantDisplayName: displayName,
    locale: input.address.locale,
    now: input.now,
    branding: mail.branding,
    overrides: mail.overrides,
    tenantDefaultLocale: mail.tenantDefaultLocale,
    supportedLocales: mail.supportedLocales,
  });
  await outboxRepository(tx).enqueue({ tenantId: input.tenantId, ...message }, input.now);
  return 'sent';
}

// What `queueApprovalNotice` does for a person who is mailed, with the final
// insert matching nothing: for a request that has no approval to point at.
export async function queueApprovalNoticeDecoy(
  tx: TenantScopedDatabase,
  input: ApprovalNotice,
  resolveMailLook: MailLookResolver | undefined,
): Promise<void> {
  await readTenant(tx, input, resolveMailLook);
  await outboxRepository(tx).enqueueNothing();
}
