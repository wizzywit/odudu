import { withTenant, type DatabaseHandle } from '@odudu/db';
import {
  baseIsTls,
  canonicalAddressFor,
  tenantDomainRepository,
  type LookupCanonicalDomain,
} from '@odudu/domain-tenant';
import { addressIssuer } from '@odudu/kernel';
import { acceptedIssuers, type AcceptedIssuersLookup } from '#/service/issuer';

// What a token, hint or client assertion presented here may have been
// issued under: the tenant's canonical issuer and any it retired whose
// window is still open. A switch needs a configured base, so without one
// nothing is retired and the request's own issuer is the whole answer.
export function acceptedIssuersLookup(deps: {
  readonly database: DatabaseHandle;
  readonly publicBaseUrl?: string | undefined;
  readonly canonicalDomain?: LookupCanonicalDomain | undefined;
}): AcceptedIssuersLookup {
  return (tenant, requestIssuer, now) => {
    const base = deps.publicBaseUrl;
    if (base === undefined) return Promise.resolve([requestIssuer]);
    return withTenant(deps.database.db, tenant.id, async (tx) => {
      const canonical = addressIssuer(
        await canonicalAddressFor(tx, tenant, base, baseIsTls(base), deps.canonicalDomain),
      );
      return acceptedIssuers(
        canonical,
        await tenantDomainRepository(tx).listRetired(tenant.id, now),
        now,
      );
    });
  };
}
