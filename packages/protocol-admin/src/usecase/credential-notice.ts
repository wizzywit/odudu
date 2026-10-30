import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { users } from '@odudu/domain-identity';
import {
  mailContext,
  outboxRepository,
  renderRecoveryCodesRevoked,
  renderSecondFactorRemoved,
  type MailLookResolver,
} from '@odudu/email';
import { eq } from 'drizzle-orm';

export type CredentialNotice =
  | {
      readonly kind: 'second_factor_removed';
      readonly factor: 'totp' | 'webauthn';
      readonly codes: boolean;
    }
  | { readonly kind: 'recovery_codes_revoked'; readonly newSet: boolean };

// The address on file, verified or not: the notice carries no link, code or
// secret, so an unverified address learns nothing it can use, and a subject
// who never verified one is exactly who an unnoticed change would hurt. A
// subject with no address is skipped without a trace, which is what a
// service subject and a user created without one both are. Queued in the
// caller's transaction, so a change that rolls back sends nothing.
export async function enqueueCredentialNotice(
  tx: TenantScopedDatabase,
  input: { readonly tenantId: string; readonly subjectId: string; readonly now: Date },
  notice: CredentialNotice,
  resolveMailLook?: MailLookResolver,
): Promise<'queued' | 'no_address'> {
  const [user] = await tx
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.subjectId, input.subjectId));
  if (user?.email == null) return 'no_address';
  const [tenant] = await tx
    .select({ name: tenants.name, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const common = {
    to: user.email,
    tenantDisplayName: tenant?.displayName ?? tenant?.name ?? '',
    locale: user.locale,
    now: input.now,
    ...(await mailContext(tx, resolveMailLook, {
      tenantId: input.tenantId,
      tenantName: tenant?.name ?? '',
    })),
  };
  const message =
    notice.kind === 'second_factor_removed'
      ? renderSecondFactorRemoved({ ...common, factor: notice.factor, codes: notice.codes })
      : renderRecoveryCodesRevoked({ ...common, newSet: notice.newSet });
  await outboxRepository(tx).enqueue({ tenantId: input.tenantId, ...message });
  return 'queued';
}
