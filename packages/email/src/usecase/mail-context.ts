import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { type MailBranding } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

export interface MailTenantScope {
  readonly tenantId: string;
  readonly tenantName: string;
  // False for a caller that shows only the theme: the wording is then not read.
  readonly wording?: boolean;
}

// The tenant's own wording for mail messages, by the language it was written
// for and then by message key.
export type MailOverrides = Readonly<Record<string, Readonly<Record<string, string>>>>;

// What a tenant's mail is dressed and worded with.
export interface MailTenantLook {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
}

// What a tenant's mail looks like and says: its theme and its own wording.
// Injected where mail is queued, because both belong to packages this one
// does not depend on. It reads through the transaction the mail is written
// in. Absent, mail is unthemed and worded by the catalogue.
export type MailLookResolver = (
  tx: TenantScopedDatabase,
  scope: MailTenantScope,
) => Promise<MailTenantLook>;

export interface MailContext {
  readonly branding: MailBranding | null;
  readonly overrides: MailOverrides;
  readonly tenantDefaultLocale: string | null;
  readonly supportedLocales: readonly string[];
}

const PLAIN: MailTenantLook = { branding: null, overrides: {} };

// A theme or wording that cannot be had never stops the mail it would have
// dressed: the resolver is told to read in a savepoint, and what it still
// throws leaves the mail unthemed and in the catalogue's words.
async function resolved(
  resolve: MailLookResolver,
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
  resolve: MailLookResolver | undefined,
  scope: MailTenantScope,
): Promise<TenantMailContext> {
  const { branding, overrides } =
    resolve === undefined ? PLAIN : await resolved(resolve, tx, scope);
  const [row] = await tx
    .select({
      defaultLocale: tenants.defaultLocale,
      supportedLocales: tenants.supportedLocales,
      displayName: tenants.displayName,
    })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId));
  return {
    branding,
    overrides,
    tenantDefaultLocale: row?.defaultLocale ?? null,
    supportedLocales: row?.supportedLocales ?? [],
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
  resolve: MailLookResolver | undefined,
  scope: MailTenantScope,
): Promise<MailContext> {
  const { branding, overrides, tenantDefaultLocale, supportedLocales } = await tenantMailContext(
    tx,
    resolve,
    scope,
  );
  return { branding, overrides, tenantDefaultLocale, supportedLocales };
}
