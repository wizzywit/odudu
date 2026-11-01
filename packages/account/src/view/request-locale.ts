import { negotiatePageLocale } from '@odudu/i18n';
import {
  brandLocale,
  clientFromReturnTo,
  withPageTheme,
  type BrandingResolver,
  type OverridesResolver,
  type PageLocale,
} from '@odudu/kernel';
import { type FastifyRequest } from 'fastify';

export interface BrandedLocaleDeps {
  // How a page asks for its tenant's or client's theme; none means the
  // default look.
  resolveBranding?: BrandingResolver | undefined;
  // The tenant's own wording for the negotiated language; none means the
  // catalogue alone.
  resolveOverrides?: OverridesResolver | undefined;
  // Whether a client_id names a registered client of the tenant, asked only
  // for a `return_to` that names one.
  isClientOfTenant?: ((tenantId: string, clientId: string) => Promise<boolean>) | undefined;
}

// The language and theme an account page is shown in. Nothing is parked here
// and the person is not signed in, so the browser's preference alone chooses
// the language; the light or dark choice comes from the odudu-theme cookie.
// The tenant's theme applies when the tenant is known, and its client's when
// `return_to` names a registered client of that same tenant; any other
// value is no client, so a page cannot say whether a client exists. A page
// with no tenant (a refused link for an unknown tenant) passes null.
export interface LocaleTenant {
  id: string;
  name: string;
  // The languages the tenant offers, and the one it prefers to the browser's
  // when it has set one.
  supportedLocales: readonly string[];
  defaultLocale: string | null;
}

export async function brandedLocale(
  request: FastifyRequest,
  deps: BrandedLocaleDeps,
  tenant: LocaleTenant | null,
  returnTo: string | null = null,
): Promise<PageLocale> {
  const locale = withPageTheme(
    negotiatePageLocale({
      acceptLanguage: request.headers['accept-language'],
      ...(tenant === null
        ? {}
        : { supported: tenant.supportedLocales, tenantDefault: tenant.defaultLocale }),
    }),
    request.headers.cookie,
  );
  if (tenant === null) return locale;
  const isClientOfTenant = deps.isClientOfTenant;
  const clientId =
    deps.resolveBranding === undefined
      ? null
      : await clientFromReturnTo(tenant.name, returnTo, (id) =>
          isClientOfTenant === undefined ? Promise.resolve(false) : isClientOfTenant(tenant.id, id),
        );
  return brandLocale(
    locale,
    deps.resolveBranding,
    { tenantId: tenant.id, tenantName: tenant.name, clientId },
    deps.resolveOverrides,
  );
}
