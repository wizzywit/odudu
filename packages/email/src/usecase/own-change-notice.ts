import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { outboxRepository } from '#/repository/outbox';
import { noticeRecipient } from '#/service/notice-recipient';
import { renderOwnChange, type OwnChange } from '#/service/templates';
import { tenantMailContext, type MailLookResolver } from '#/usecase/mail-context';

export interface OwnChangeNotice {
  readonly tenantId: string;
  // What the subject's row holds: the address, whether it was proved, and the
  // language the mail is read in.
  readonly address: {
    readonly email: string | null;
    readonly verified: boolean;
    readonly locale: string | null;
  };
  readonly now: Date;
}

// What an audit row records as `notice`.
export type NoticeOutcome = 'sent' | 'skipped_unverified' | 'skipped_none';

// Queued in the transaction that made the change, so a change that rolls back
// tells nobody. The tenant's theme is read through that transaction too, and
// nothing is read at all when no mail will be sent.
export async function queueOwnChangeNotice(
  tx: TenantScopedDatabase,
  input: OwnChangeNotice,
  change: OwnChange,
  resolveMailLook: MailLookResolver | undefined,
): Promise<NoticeOutcome> {
  const recipient = noticeRecipient(input.address.email, input.address.verified);
  if (!recipient.send) return `skipped_${recipient.reason}`;

  const [tenant] = await tx
    .select({ name: tenants.name, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const name = tenant?.name ?? '';
  const mail = await tenantMailContext(tx, resolveMailLook, {
    tenantId: input.tenantId,
    tenantName: name,
  });
  const message = renderOwnChange({
    to: recipient.to,
    tenantDisplayName: tenant?.displayName ?? name,
    locale: input.address.locale,
    now: input.now,
    change,
    branding: mail.branding,
    overrides: mail.overrides,
    tenantDefaultLocale: mail.tenantDefaultLocale,
    supportedLocales: mail.supportedLocales,
  });
  await outboxRepository(tx).enqueue({ tenantId: input.tenantId, ...message }, input.now);
  return 'sent';
}
