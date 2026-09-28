import { TENANT_NAME_RULE, UNSAFE_RETURN_TO } from '@odudu/contracts';
import { SYSTEM_TENANT, type Principal } from '#/shared/service/principal.ts';

export {
  isTenantName,
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';

const ROOT = '/console/';
const RESOLVE_AGAINST = 'http://console.invalid';
// Sign-in and the API are the gateway's own routes, not pages to return to.
const NOT_PAGES = ['/console/auth/', '/console/api/'];

// Where a sign-in comes back to: a console page on this origin, never a
// gateway route or anywhere else. Anything doubtful is the console root.
export function returnPath(asked: string): string {
  if (!asked.startsWith('/') || asked.startsWith('//') || UNSAFE_RETURN_TO.test(asked)) {
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

// The words a refused tenant name is answered with, as a sentence.
export const TENANT_NAME_PROBLEM = `${TENANT_NAME_RULE.charAt(0).toUpperCase()}${TENANT_NAME_RULE.slice(1)}.`;

// The query parameter the gateway's callback names an authorization error in.
export const LOGIN_ERROR = 'login_error';

const TRY_AGAIN = 'The tenant needs you to finish signing in on its own page. Try again.';
const REFUSED =
  "The tenant refused the console's sign-in request. Try again, and tell the tenant's operator if it keeps happening.";

// RFC 6749 §4.1.2.1's codes, and OpenID Connect Core §3.1.2.6's, in words.
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  access_denied: 'Sign-in was cancelled.',
  temporarily_unavailable: "The tenant's sign-in is unavailable just now. Try again shortly.",
  server_error: "The tenant's sign-in failed on its side. Try again.",
  login_required: TRY_AGAIN,
  interaction_required: TRY_AGAIN,
  consent_required: TRY_AGAIN,
  account_selection_required: TRY_AGAIN,
  invalid_request: REFUSED,
  invalid_request_uri: REFUSED,
  unauthorized_client: REFUSED,
  unsupported_response_type: REFUSED,
  invalid_scope: REFUSED,
};

export function loginErrorMessage(code: string): string {
  return Object.hasOwn(LOGIN_ERRORS, code)
    ? (LOGIN_ERRORS[code] ?? '')
    : 'Sign-in did not complete. Try again.';
}

export function draftOwner(principal: Principal): string {
  return `${principal.tenant}/${principal.subjectId}`;
}

// A tenant administrator opening another tenant's console is asked first:
// signing in there replaces this session. A system administrator enters.
export function signedInElsewhere(principal: Principal | null, tenant: string): boolean {
  return principal !== null && principal.tenant !== tenant && principal.tenant !== SYSTEM_TENANT;
}

export function tenantPage(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}`;
}
