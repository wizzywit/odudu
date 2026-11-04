import { type TenantScopedDatabase } from '@odudu/db';
import { domainAddress, pathAddress, type TenantAddress } from '@odudu/kernel';

/** The tenant's canonical host, or null when it has none. */
export type LookupCanonicalDomain = (
  tx: TenantScopedDatabase,
  tenantId: string,
) => Promise<string | null>;

const noCanonicalDomain: LookupCanonicalDomain = () => Promise.resolve(null);

// What a mail link, a brand asset in a mail or a queued logout names when no
// request is in hand to say which address the person used. The base is the
// configured public base URL and never a request's authority: a header a
// caller controls must not decide where a mailed link points.
export async function canonicalAddressFor(
  tx: TenantScopedDatabase,
  tenant: { readonly id: string; readonly name: string },
  base: string,
  tls: boolean,
  lookupDomain: LookupCanonicalDomain = noCanonicalDomain,
): Promise<TenantAddress> {
  const host = await lookupDomain(tx, tenant.id);
  return host === null ? pathAddress(base, tenant.name) : domainAddress(host, tls);
}

// The scheme a canonical domain is served over follows the configured base:
// a deployment reached over https puts its domains behind the same proxy.
export function baseIsTls(base: string): boolean {
  return new URL(base).protocol === 'https:';
}
