import type { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

// Who is signed in, as GET /console/api/session reports it: the tenant is
// the one the session was issued by, which a system administrator carries
// into every tenant they enter.
export interface Principal {
  readonly tenant: string;
  readonly subjectId: string;
  readonly username: string;
}

// What whoami says the principal holds on one tenant: advice for what to
// render, never authority, since every request is authorised by the server.
export interface Authority {
  readonly capabilities: readonly AdminCapability[];
  readonly crossTenant: boolean;
}

export const SYSTEM_TENANT = 'system';

const ROOT = '/console/';
const RESOLVE_AGAINST = 'http://console.invalid';
// Sign-in and the API are the gateway's own routes, not pages to return to.
const NOT_PAGES = ['/console/auth/', '/console/api/'];

// Where a sign-in comes back to: a console page on this origin, never a
// gateway route or anywhere else. Anything doubtful is the console root.
export function returnPath(asked: string): string {
  if (!asked.startsWith('/') || asked.startsWith('//') || /[\\\u0000-\u001f]/u.test(asked)) {
    return ROOT;
  }
  const url = new URL(asked, RESOLVE_AGAINST);
  if (url.origin !== RESOLVE_AGAINST) return ROOT;
  if (url.pathname === '/console') return ROOT;
  if (!url.pathname.startsWith(ROOT) || NOT_PAGES.some((p) => url.pathname.startsWith(p))) {
    return ROOT;
  }
  return `${url.pathname}${url.search}`;
}

export function loginUrl(tenant: string, returnTo: string): string {
  const query = new URLSearchParams({ tenant, return_to: returnPath(returnTo) });
  return `/console/auth/login?${query.toString()}`;
}

// The DNS-label rule @odudu/domain-tenant's isValidTenantName holds a
// tenant name to, so a mistyped one is refused here rather than by the
// tenant's sign-in page.
const TENANT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function isTenantName(name: string): boolean {
  return TENANT_NAME.test(name);
}

export function draftOwner(principal: Principal): string {
  return `${principal.tenant}/${principal.subjectId}`;
}
