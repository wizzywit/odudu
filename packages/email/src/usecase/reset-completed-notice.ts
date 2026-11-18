import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { outboxRepository } from '#/repository/outbox';
import { renderResetCompleted } from '#/service/templates';
import { tenantMailContext, type MailLookResolver } from '#/usecase/mail-context';

export interface ResetCompletedNotice {
  readonly tenantId: string;
  readonly address: { readonly email: string | null; readonly locale: string | null };
  readonly now: Date;
}

// To the address on file, verified or not: the notice carries no link, code or
// secret, and a person who never verified an address is who an unnoticed reset
// would hurt. A subject with no address is skipped without a trace. Queued in
// the transaction that set the password, so a rollback sends nothing.
export async function queueResetCompletedNotice(
  tx: TenantScopedDatabase,
  input: ResetCompletedNotice,
  resolveMailLook: MailLookResolver | undefined,
): Promise<'sent' | 'skipped_none'> {
  const to = input.address.email;
  if (to === null || to === '') return 'skipped_none';

  const [tenant] = await tx
    .select({ name: tenants.name, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const name = tenant?.name ?? '';
  const mail = await tenantMailContext(tx, resolveMailLook, {
    tenantId: input.tenantId,
    tenantName: name,
  });
  const message = renderResetCompleted({
    to,
    tenantDisplayName: tenant?.displayName ?? name,
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
