import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import { mailContext } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { addressToProveAgain } from '#/service/resend-link';
import { type MailGate } from '#/service/mail-gate';
import { mailAddressOf } from '#/usecase/mail-address';
import { enqueueVerificationLink, type SendVerificationEmailDeps } from '#/usecase/verify-email';

export interface ResendVerificationDeps extends Omit<SendVerificationEmailDeps, 'database'> {
  readonly database: DatabaseHandle;
  readonly request: RequestContext;
  readonly mailGate: MailGate;
  // Whether `email` still needs proving for the subject, as the current address
  // that was never verified or as the pending one, and the language the new
  // mail is written in. Injected: the identity tables belong to
  // @odudu/domain-identity.
  readonly proofOwed: (
    tx: TenantScopedDatabase,
    subjectId: string,
    email: string,
  ) => Promise<{ readonly locale: string | null } | null>;
}

// Queues a new verification mail for the address a spent or expired link was
// minted for, and says nothing of whether it did: the caller shows the same
// page for a key nothing holds, an address that needs nothing, a spent budget
// and a mail queued. The theme is read before the key is looked up, as a
// password reset reads it before the address, so that read is no part of what
// tells them apart.
export async function resendVerification(deps: ResendVerificationDeps, key: string): Promise<void> {
  await withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx) => {
      const address = await mailAddressOf(tx, deps);
      const mail = await mailContext(tx, deps.resolveMailLook, { ...deps, address });
      const record = await actionTokenRepository(tx).lookup(key);
      const email = addressToProveAgain(record);
      if (record === null || email === null) return;
      const owed = await deps.proofOwed(tx, record.subjectId, email);
      if (owed === null || !deps.mailGate('verification', deps.tenantId, email)) return;
      await enqueueVerificationLink(
        tx,
        deps,
        {
          subjectId: record.subjectId,
          email,
          locale: owed.locale,
          returnTo: record.returnTo ?? undefined,
        },
        mail,
      );
      await auditRepository(tx).record({
        eventType: 'credential',
        action: 'email.verification_resent',
        outcome: 'allowed',
        resourceType: 'subject',
        resourceId: record.subjectId,
      });
    },
    deps.request,
  );
}
