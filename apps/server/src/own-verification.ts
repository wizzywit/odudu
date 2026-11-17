import { enqueueVerificationLink, ownVerificationVerdict, type MailGate } from '@odudu/account';
import { tenants, withTenant, type DatabaseHandle } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import { type MailLookResolver } from '@odudu/email';
import { userRepository } from '@odudu/domain-identity';
import { tenantSmtpRepository } from '@odudu/protocol-admin';
import { eq } from 'drizzle-orm';

export interface OwnVerificationDeps {
  readonly database: DatabaseHandle;
  readonly publicBaseUrl: string | undefined;
  readonly deploymentSmtp: boolean;
  readonly mailGate: MailGate;
  readonly resolveMailLook: MailLookResolver;
  readonly now: () => Date;
}

export type OwnVerificationResult = 'queued' | 'limited' | 'unavailable' | 'verified';

// The mail that proves the address a person holds, for the page that asks them
// to prove it. The tenant's own sender is read here, and the verdict is the
// account package's.
export async function queueOwnVerification(
  deps: OwnVerificationDeps,
  tenantId: string,
  subjectId: string,
  request: RequestContext,
): Promise<OwnVerificationResult> {
  const issuerBase = deps.publicBaseUrl;
  return withTenant(
    deps.database.db,
    tenantId,
    async (tx) => {
      const user = await userRepository(tx).bySubjectId(subjectId);
      const email = user?.email ?? null;
      const verdict = ownVerificationVerdict(
        {
          verified: user?.emailVerified === true,
          hasEmail: email !== null,
          mailAvailable:
            issuerBase !== undefined &&
            (deps.deploymentSmtp || (await tenantSmtpRepository(tx).byTenantId(tenantId)) !== null),
        },
        () => email !== null && deps.mailGate('verification', tenantId, email),
      );
      if (verdict !== 'send') return verdict;
      if (user === null || email === null || issuerBase === undefined) return 'unavailable';
      const [names] = await tx
        .select({ name: tenants.name, displayName: tenants.displayName })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (names === undefined) return 'unavailable';
      await enqueueVerificationLink(
        tx,
        {
          tenantId,
          tenantName: names.name,
          tenantDisplayName: names.displayName ?? names.name,
          issuerBase,
          now: deps.now,
          resolveMailLook: deps.resolveMailLook,
        },
        { subjectId, email, locale: user.locale },
      );
      await auditRepository(tx).record({
        eventType: 'credential',
        action: 'email.verification_resent',
        outcome: 'allowed',
        actorSubjectId: subjectId,
        resourceType: 'subject',
        resourceId: subjectId,
      });
      return 'queued';
    },
    request,
  );
}
