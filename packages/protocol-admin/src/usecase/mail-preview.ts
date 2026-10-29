import { type PreviewMailQuery } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  brandingInScheme,
  inlineMark,
  tenantMailContext,
  renderVerifyEmail,
  type MailLookResolver,
  type MailOverrides,
} from '@odudu/email';
import { type MailBranding } from '@odudu/kernel';
import { clientRepository } from '@odudu/domain-tenant';

export interface MailPreviewDeps {
  readonly resolveMailLook: MailLookResolver;
}

export interface TenantMail {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
  readonly tenantDefaultLocale: string | null;
  readonly displayName: string;
}

// What the tenant's mail is dressed and worded in as of its published theme
// and its message overrides: the read a queued mail makes, so the preview and
// the mail cannot disagree. The tenant's row, the resolver's read of the
// published theme (which it bounds and caches) and, unless `wording` is
// false, one read of the overrides; none grows with what they hold.
export async function tenantMail(
  tx: TenantScopedDatabase,
  deps: MailPreviewDeps,
  tenant: { tenantId: string; tenantName: string },
  wording = true,
): Promise<TenantMail> {
  const { displayName, ...context } = await tenantMailContext(tx, deps.resolveMailLook, {
    ...tenant,
    wording,
  });
  return { ...context, displayName: displayName ?? tenant.tenantName };
}

export interface ClientMail extends TenantMail {
  // The tenant's own look, for saying which layer supplied a palette.
  readonly tenantBranding: MailBranding | null;
}

// What a mail whose flow began inside this client's sign-in is dressed in, or
// null when the tenant has no such client (a foreign client's id is the same
// answer). The client's own theme is read by the same resolver a queued mail
// uses, so a client that is disabled shows the tenant's look, as its mail
// would. The client's row, the tenant's row, the client-bound theme read and,
// for the branding view, one read of the tenant's: constant, whatever a theme
// names.
export async function clientMail(
  tx: TenantScopedDatabase,
  deps: MailPreviewDeps,
  tenant: { tenantId: string; tenantName: string },
  clientRowId: string,
  wording = true,
): Promise<ClientMail | null> {
  const client = await clientRepository(tx).byId(clientRowId);
  if (client === null) return null;
  const { displayName, ...context } = await tenantMailContext(tx, deps.resolveMailLook, {
    ...tenant,
    wording,
    clientId: client.clientId,
  });
  const own = wording
    ? null
    : (await deps.resolveMailLook(tx, { ...tenant, wording: false, clientId: null })).branding;
  return {
    ...context,
    displayName: displayName ?? tenant.tenantName,
    tenantBranding: own,
  };
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
