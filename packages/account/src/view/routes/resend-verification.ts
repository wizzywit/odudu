import { type DatabaseHandle } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { type MailLookResolver } from '@odudu/email';
import { type FastifyInstance } from 'fastify';
import { ensureTenantAddress } from '#/view/routes/tenant-address';
import { type MailGate } from '#/service/mail-gate';
import { resendVerification, type ResendVerificationDeps } from '#/usecase/resend-verification';
import { brandedLocale, type BrandedLocaleDeps } from '#/view/request-locale';
import { renderVerificationResentPage, sendVerificationHtml } from '#/view/verification-html';

export interface ResendVerificationTenantLookup {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string | null;
  readonly enabled: boolean;
}

export interface ResendVerificationRouteDeps extends BrandedLocaleDeps {
  readonly database: DatabaseHandle;
  readonly findTenant: (name: string) => Promise<ResendVerificationTenantLookup | null>;
  // Operator configuration, never read off the request; unset, nothing is sent.
  readonly publicBaseUrl: string | undefined;
  readonly now: () => Date;
  readonly resolveMailLook: MailLookResolver;
  readonly mailGate: MailGate;
  readonly proofOwed: ResendVerificationDeps['proofOwed'];
}

function firstNonEmptyString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// The key is the spent link's own: whoever holds it received that mail, so the
// form names no address and the lookup is by the key's hash. Every request
// gets the one page, so nothing here says whether the key was ever issued or
// whether a mail was queued.
export function registerResendVerificationRoute(
  app: FastifyInstance,
  deps: ResendVerificationRouteDeps,
): void {
  ensureTenantAddress(app);
  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/resend-verification', async (request, reply) => {
    const key = firstNonEmptyString(request.body.key);
    const tenant = await deps.findTenant(request.params.tenant);
    const locale = await brandedLocale(request, deps, tenant);
    if (key !== undefined && tenant?.enabled === true && deps.publicBaseUrl !== undefined) {
      await resendVerification(
        {
          database: deps.database,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantDisplayName: tenant.displayName ?? tenant.name,
          issuerBase: deps.publicBaseUrl,
          now: deps.now,
          resolveMailLook: deps.resolveMailLook,
          request: requestContextFrom(request),
          mailGate: deps.mailGate,
          proofOwed: deps.proofOwed,
        },
        key,
      );
    }
    return sendVerificationHtml(reply, 200, renderVerificationResentPage(locale));
  });
}
