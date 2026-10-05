import { UNSAFE_RETURN_TO } from '@odudu/contracts';
import { type SignOutAnswer } from '#/features/session/service/boot.ts';

export {
  isTenantName,
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';

export const CONSOLE_ROOT = '/console/';

const ROOT = CONSOLE_ROOT;

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

export function tenantPage(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}`;
}

export const CHOOSE_TENANT = 'choose';

export const SWITCH_HREF = `/console/?${CHOOSE_TENANT}`;

export function signOutDestination(result: SignOutAnswer): string {
  return result.ok ? result.redirect : CONSOLE_ROOT;
}
