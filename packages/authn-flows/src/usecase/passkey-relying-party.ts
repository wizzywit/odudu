import { type TenantScopedDatabase } from '@odudu/db';
import { canonicalHostOf } from '@odudu/domain-tenant';
import { canonicalRelyingParty, ceremonyRelyingParty, type RelyingParty } from '#/service/webauthn';

// The relying party a ceremony runs against: the tenant's canonical address,
// read here rather than taken from the request, so a passkey is registered
// and asserted at one origin only.
export async function relyingPartyOfTenant(
  tx: TenantScopedDatabase,
  tenantId: string,
  base: string,
): Promise<RelyingParty> {
  return canonicalRelyingParty(await canonicalHostOf(tx, tenantId), base);
}

// The same, for a login: where no relying party can be derived nothing is
// asserted and no passkey can exist.
export async function relyingPartyOfTenantOrNone(
  tx: TenantScopedDatabase,
  tenantId: string,
  base: string | null,
): Promise<RelyingParty | null> {
  return ceremonyRelyingParty(await canonicalHostOf(tx, tenantId), base);
}
