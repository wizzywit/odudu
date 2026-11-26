import { type TenantScopedDatabase } from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  provisionAssistantClient as provisionClientRow,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

/**
 * The built-in `odudu-assistant` client, whole: the client row, which
 * @odudu/domain-tenant owns, plus an agent-type OIDC configuration that no
 * protocol endpoint can use. It registers no redirect URI, so /authorize has
 * nowhere to send a code, and its one grant is `client_credentials`, which a
 * public client is refused; the database requires one or the other. A
 * conversation's grant, made by `grantAssistantAccess`, is the only thing
 * that ever names it. Idempotent in both halves.
 */
export async function provisionAssistantClient(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ClientRecord> {
  const client = await provisionClientRow(tx, tenantId);
  const configs = clientOidcConfigRepository(tx);
  if ((await configs.byClientId(client.id)) === null) {
    await configs.create({
      clientId: client.id,
      tenantId,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'none',
      audiences: [ADMIN_API_AUDIENCE],
      accessTokenTtlSeconds: 300,
      idTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 300,
      agentType: true,
    });
  }
  return client;
}
