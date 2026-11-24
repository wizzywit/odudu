import { UNSAFE_RETURN_TO } from '@odudu/contracts';
import { isValidTenantName } from '@odudu/domain-tenant';
import { addressUrl, domainAddress, isUuid } from '@odudu/kernel';

const PREFIX = '/console/';
const BASE = 'https://console.invalid';
// The approval page of a CIBA request, which a mailed link opens: a person
// with no session signs in through the console and comes back to it.
const APPROVAL = /^\/tenants\/([^/]+)\/approval\/([^/]+)$/u;

// The tenant and approval an approval page path names, or null for anything
// else: a query, a fragment, a trailing path, a name or an id that is not one.
export function approvalPageOf(pathname: string): { tenant: string; id: string } | null {
  const [, tenant, id] = APPROVAL.exec(pathname) ?? [];
  return tenant !== undefined && id !== undefined && isValidTenantName(tenant) && isUuid(id)
    ? { tenant, id }
    : null;
}

export function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value === '' || UNSAFE_RETURN_TO.test(value)) return PREFIX;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return PREFIX;
  }

  if (url.origin !== BASE) return PREFIX;
  if (approvalPageOf(url.pathname) !== null && url.search === '' && url.hash === '')
    return url.pathname;
  if (!url.pathname.startsWith(PREFIX)) return PREFIX;

  return url.pathname + url.search + url.hash;
}

// Where a finished console sign-in sends the browser. A path the request named
// is first held to `safeReturnTo`. The approval page of a tenant on a domain of
// its own is not served from the console's origin, where the tenant's session
// cookie does not exist, so its path is mapped to that tenant's canonical
// domain, which the caller read from the verified domain row. Nothing in the
// request chooses the host, and the page of another tenant than the one that
// signed in is not a destination. The host is read only when it is needed.
export async function signInDestination(
  returnTo: string | undefined,
  tenantName: string,
  canonicalHost: () => Promise<string | null>,
  tls: boolean,
): Promise<string> {
  const back = safeReturnTo(returnTo);
  const page = approvalPageOf(back);
  if (page === null) return back;
  if (page.tenant !== tenantName) return PREFIX;
  const host = await canonicalHost();
  return host === null ? back : addressUrl(domainAddress(host, tls), `/approval/${page.id}`);
}
