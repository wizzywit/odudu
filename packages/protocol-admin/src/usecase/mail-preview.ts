import { type PreviewMailQuery } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  brandingInScheme,
  inlineMark,
  tenantMailContext,
  renderVerifyEmail,
  type MailBrandingResolver,
  type MailOverrides,
} from '@odudu/email';
import { type MailBranding } from '@odudu/kernel';

export interface MailPreviewDeps {
  readonly resolveMailBranding: MailBrandingResolver;
}

export interface TenantMail {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
  readonly tenantDefaultLocale: string | null;
  readonly displayName: string;
}

// What the tenant's mail is dressed in as of its published theme: the read a
// queued mail makes, so the preview and the mail cannot disagree. One tenant
// statement, plus the resolver's own read of the published theme, which the
// resolver bounds and caches; neither grows with what the theme names.
export async function tenantMail(
  tx: TenantScopedDatabase,
  deps: MailPreviewDeps,
  tenant: { tenantId: string; tenantName: string },
): Promise<TenantMail> {
  const { displayName, ...context } = await tenantMailContext(tx, deps.resolveMailBranding, tenant);
  return { ...context, displayName: displayName ?? tenant.tenantName };
}

export interface MailPreviewInput {
  readonly query: PreviewMailQuery;
  readonly issuerBase: string;
  readonly now: Date;
}

// The verification mail with a sample address and link, drawn in one scheme.
// Nothing is queued and nothing is written.
export function previewMail(
  mail: TenantMail,
  input: MailPreviewInput,
): { html: string; branding: MailBranding } {
  const branding = brandingInScheme(mail.branding, input.query.scheme ?? 'light');
  const message = renderVerifyEmail({
    to: 'ada@example.test',
    link: `${input.issuerBase}/verify-email?sample=1`,
    tenantDisplayName: mail.displayName,
    now: input.now,
    locale: input.query.locale ?? null,
    tenantDefaultLocale: mail.tenantDefaultLocale,
    overrides: mail.overrides,
    branding,
  });
  return { html: inlineMark(message.html), branding };
}
