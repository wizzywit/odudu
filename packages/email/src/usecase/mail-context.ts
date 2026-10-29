import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { type MailBranding } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

export interface MailTenantScope {
  readonly tenantId: string;
  readonly tenantName: string;
}

// The tenant's own wording for mail messages, by the language it was written
// for and then by message key.
export type MailOverrides = Readonly<Record<string, Readonly<Record<string, string>>>>;

// What a tenant's mail is dressed and worded with.
export interface MailTenantLook {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
}

// Injected where mail is queued, because the theme and the overrides belong
// to packages this one does not depend on. It reads through the transaction
// the mail is written in. Absent, mail is unthemed and worded by the catalogue.
export type MailBrandingResolver = (
  tx: TenantScopedDatabase,
  scope: MailTenantScope,
) => Promise<MailTenantLook>;

export interface MailContext {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
  readonly tenantDefaultLocale: string | null;
}

const PLAIN: MailTenantLook = { branding: null, overrides: {} };

// A theme or wording that cannot be had never stops the mail it would have
// dressed: the resolver is told to read in a savepoint, and what it still
// throws leaves the mail unthemed and in the catalogue's words.
async function resolved(
  resolve: MailBrandingResolver,
  tx: TenantScopedDatabase,
  scope: MailTenantScope,
): Promise<MailTenantLook> {
  try {
    return await resolve(tx, scope);
  } catch {
    return PLAIN;
  }
}

export interface TenantMailContext extends MailContext {
  readonly displayName: string | null;
}

// The same read that also names the tenant, for a caller that shows a mail
// before it is sent: one theme read and one tenant statement, whatever the
// theme names.
export async function tenantMailContext(
  tx: TenantScopedDatabase,
  resolve: MailBrandingResolver | undefined,
  scope: MailTenantScope,
): Promise<TenantMailContext> {
  const { branding, overrides } =
    resolve === undefined ? PLAIN : await resolved(resolve, tx, scope);
  const [row] = await tx
    .select({ defaultLocale: tenants.defaultLocale, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId));
  return {
    branding,
    overrides,
    tenantDefaultLocale: row?.defaultLocale ?? null,
    displayName: row?.displayName ?? null,
  };
}

// What a mail needs from its tenant beyond the text, decided once when the
// mail is queued: the outbox row keeps the rendered result, so a theme
// published after this moment does not reach a mail already queued. Both
// reads are made whether or not the mail is then written, so a caller that
// must answer in the same time either way can make them before it decides.
export async function mailContext(
  tx: TenantScopedDatabase,
  resolve: MailBrandingResolver | undefined,
  scope: MailTenantScope,
): Promise<MailContext> {
  const { branding, overrides, tenantDefaultLocale } = await tenantMailContext(tx, resolve, scope);
  return { branding, overrides, tenantDefaultLocale };
}
