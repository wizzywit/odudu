import { type PendingRequest } from '@odudu/authn-flows';
import { negotiatePageLocale } from '@odudu/i18n';
import {
  brandLocale,
  type BrandingResolver,
  type OverridesResolver,
  type PageLocale,
  type RenderedPage,
  withPageTheme,
} from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { restartAuthorizeLocation } from '#/service/restart-request';

// What a tenant says about the languages of its pages.
export interface TenantLocales {
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string | null;
}

export interface ContinuationDeps {
  findTenant(name: string): Promise<({ id: string } & TenantLocales) | null>;
  loadPendingRequest(tenantId: string, authSessionId: string): Promise<PendingRequest | null>;
  // The parked request whatever the session's state: expired, consumed or
  // live. Not a liveness check, so never a reason to act on the session;
  // sendSignInExpired reads it only to rebuild a link to /authorize.
  recoverPendingRequest(tenantId: string, authSessionId: string): Promise<PendingRequest | null>;
  // Whether the client is still enabled and still registers this
  // redirect_uri. A parked redirect_uri was validated once; it is offered
  // back to the person only if it still is.
  redirectStillRegistered(
    tenantId: string,
    oauthClientId: string,
    redirectUri: string,
  ): Promise<boolean>;
  // The name of a client in its tenant, or null when there is none. Read only
  // by a page that says whom the person is signing in to.
  clientName?(tenantId: string, oauthClientId: string, localeTag: string): Promise<string | null>;
  // The `locale` attribute of a subject, read only for a page shown after
  // the first factor was verified (ADR 0043, step 2).
  subjectLocale?(tenantId: string, subjectId: string): Promise<string | null>;
  // Whom a finished authentication bound to this session, for pages shown
  // once it is finished.
  authenticatedSubject?(tenantId: string, authSessionId: string): Promise<string | null>;
  // The tenant's or client's own look; none means every page is the default.
  resolveBranding?: BrandingResolver;
  // The tenant's own wording for the negotiated language; none means every
  // page reads the catalogue alone.
  resolveOverrides?: OverridesResolver;
}

// The languages a tenant offers and the one it falls back to, in the shape
// negotiation takes; a page with no tenant in scope offers what is shipped.
export function tenantNegotiation(tenant: TenantLocales | null): {
  supported?: readonly string[];
  tenantDefault?: string | null;
} {
  return tenant === null
    ? {}
    : { supported: tenant.supportedLocales, tenantDefault: tenant.defaultLocale };
}

// The language a page with no tenant in scope is shown in: the browser's
// preference alone, since nothing else about the request is known. Any page
// that has a tenant goes through `brandedRequestLocale` or `continuation`.
export function requestLocale(reply: FastifyReply): PageLocale {
  return withPageTheme(
    negotiatePageLocale({ acceptLanguage: reply.request.headers['accept-language'] }),
    reply.request.headers.cookie,
  );
}

// One lookup of a tenant per request: the usecase and the page it renders
// ask for the same name, and the second answer is the first.
export function lookingUpTenantOnce<D extends { findTenant(name: string): Promise<unknown> }>(
  deps: D,
): D {
  const found = new Map<string, ReturnType<D['findTenant']>>();
  return {
    ...deps,
    findTenant: (name: string) => {
      const held = found.get(name);
      if (held !== undefined) return held;
      const asked = deps.findTenant(name) as ReturnType<D['findTenant']>;
      found.set(name, asked);
      return asked;
    },
  };
}

// A page that has a tenant by name and no parked request: the browser's
// language among the tenant's, and the tenant's theme and wording. A client's
// theme is worn only when the caller passes one it has verified; nothing a
// request carries names one reliably.
export async function brandedRequestLocale(
  deps: Pick<ContinuationDeps, 'findTenant' | 'resolveBranding' | 'resolveOverrides'>,
  reply: FastifyReply,
  tenantName: string,
  verifiedClientId: string | null = null,
): Promise<PageLocale> {
  const tenant = await deps.findTenant(tenantName);
  const locale = withPageTheme(
    negotiatePageLocale({
      acceptLanguage: reply.request.headers['accept-language'],
      ...tenantNegotiation(tenant),
    }),
    reply.request.headers.cookie,
  );
  return brandLocale(
    locale,
    deps.resolveBranding,
    tenant === null ? null : { tenantId: tenant.id, tenantName, clientId: verifiedClientId },
    deps.resolveOverrides,
  );
}

// Who is asking for the page, as far as the language may use it. `subject`
// names a subject whose first factor is verified; `authenticated` asks the
// session which one a finished authentication bound.
export type PageSubject = { readonly subject: string } | 'authenticated';

export interface PageContinuation {
  // Negotiated before the renderer runs, so the text and the `lang` it is
  // sent under come from one value (ADR 0043). It carries the person's
  // light or dark choice too, read from the request's cookie.
  readonly locale: PageLocale;
  // A page whose form continues a parked authorization request can be
  // answered with a 302 to that request's client, so it names the client's
  // redirect_uri for `pageHeaders` to license (ADR 0018). The value is the
  // one /authorize validated and parked, never anything the browser posted.
  readonly continuing: (page: RenderedPage) => RenderedPage;
  // The name of the client the parked request is for. One read, made when it
  // is called and not before, so a page that never names a client costs none.
  readonly clientName: () => Promise<string | undefined>;
  // The authorize path that starts this sign-in again, built from the request
  // already loaded; null when there is none or it cannot be rebuilt faithfully
  // (one tied to a subject by a hint). No read of its own.
  readonly signInPath: string | null;
}

// Loads the parked request once and answers both questions that need it: the
// page's language (`ui_locales`, then the subject's own locale once they are
// known, then Accept-Language) and the redirect its form may follow.
export async function continuation(
  deps: ContinuationDeps,
  tenantName: string,
  authSessionId: string,
  reply: FastifyReply,
  who?: PageSubject,
): Promise<PageContinuation> {
  const tenant = await deps.findTenant(tenantName);
  const pending = tenant === null ? null : await deps.loadPendingRequest(tenant.id, authSessionId);
  let subjectId: string | null = null;
  if (tenant !== null && who !== undefined) {
    subjectId =
      who === 'authenticated'
        ? ((await deps.authenticatedSubject?.(tenant.id, authSessionId)) ?? null)
        : who.subject;
  }
  const subjectLocale =
    tenant !== null && subjectId !== null
      ? ((await deps.subjectLocale?.(tenant.id, subjectId)) ?? null)
      : null;
  const locale = await brandLocale(
    withPageTheme(
      negotiatePageLocale({
        uiLocales: pending?.uiLocales ?? [],
        subjectLocale,
        authenticated: subjectId !== null,
        acceptLanguage: reply.request.headers['accept-language'],
        ...tenantNegotiation(tenant),
      }),
      reply.request.headers.cookie,
    ),
    deps.resolveBranding,
    tenant === null
      ? null
      : { tenantId: tenant.id, tenantName, clientId: pending?.clientId ?? null },
    deps.resolveOverrides,
  );
  return {
    locale,
    continuing: (page) => (pending === null ? page : { ...page, redirectsTo: pending.redirectUri }),
    signInPath: pending === null ? null : restartAuthorizeLocation(tenantName, pending),
    clientName: async () =>
      tenant === null || pending === null
        ? undefined
        : ((await deps.clientName?.(tenant.id, pending.clientId, locale.tag)) ?? undefined),
  };
}
