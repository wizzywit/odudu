import { type TenantScopedDatabase } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { type ReturnClient } from '@odudu/account';

// The registration an administrator-issued link is checked against when it is
// opened: the client by its internal id, read through the tenant's own rows, so
// another tenant's client is none at all. The account package cannot reach the
// OIDC client config, so the pair meets here.
export async function findReturnClient(
  tx: TenantScopedDatabase,
  clientId: string,
): Promise<ReturnClient | null> {
  const client = await clientRepository(tx).byId(clientId);
  if (client === null) return null;
  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  return { enabled: client.enabled, redirectUris: config?.redirectUris ?? [] };
}
