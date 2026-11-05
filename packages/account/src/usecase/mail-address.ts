import { type TenantScopedDatabase } from '@odudu/db';
import { baseIsTls, canonicalAddressFor, type LookupCanonicalDomain } from '@odudu/domain-tenant';
import { type TenantAddress } from '@odudu/kernel';

export interface MailAddressTenant {
  readonly tenantId: string;
  readonly tenantName: string;
  // Operator configuration, never a request's authority.
  readonly issuerBase: string;
  readonly lookupDomain?: LookupCanonicalDomain | undefined;
}

// The address a mailed link and the mail's brand assets name, read in the
// transaction that queues the mail.
export function mailAddressOf(
  tx: TenantScopedDatabase,
  tenant: MailAddressTenant,
): Promise<TenantAddress> {
  return canonicalAddressFor(
    tx,
    { id: tenant.tenantId, name: tenant.tenantName },
    tenant.issuerBase,
    baseIsTls(tenant.issuerBase),
    tenant.lookupDomain,
  );
}
