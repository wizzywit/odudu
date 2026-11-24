import { UNSAFE_RETURN_TO } from '@odudu/contracts';
import { isValidTenantName } from '@odudu/domain-tenant';
import { isUuid } from '@odudu/kernel';

const PREFIX = '/console/';
const BASE = 'https://console.invalid';
// The approval page of a CIBA request, which a mailed link opens: a person
// with no session signs in through the console and comes back to it.
const APPROVAL = /^\/tenants\/([^/]+)\/approval\/([^/]+)$/u;

function isApprovalPage(pathname: string): boolean {
  const [, tenant, id] = APPROVAL.exec(pathname) ?? [];
  return tenant !== undefined && id !== undefined && isValidTenantName(tenant) && isUuid(id);
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
  if (isApprovalPage(url.pathname) && url.search === '' && url.hash === '') return url.pathname;
  if (!url.pathname.startsWith(PREFIX)) return PREFIX;

  return url.pathname + url.search + url.hash;
}
