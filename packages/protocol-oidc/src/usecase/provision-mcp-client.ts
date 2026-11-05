import { type TenantScopedDatabase } from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  MCP_CLIENT_LIFETIMES,
  MCP_CLIENT_REDIRECT_URIS,
  provisionMcpClient as provisionClientRow,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

/**
 * The built-in `odudu-mcp` client, whole: the public client row and its
 * scope assignments, which @odudu/domain-tenant owns, plus the OIDC
 * configuration without which /authorize refuses it. Idempotent in both
 * halves. Its access token is for the admin API, so it holds no secret.
 */
export async function provisionMcpClient(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ClientRecord> {
  const client = await provisionClientRow(tx, tenantId);
  const configs = clientOidcConfigRepository(tx);
  if ((await configs.byClientId(client.id)) === null) {
    await configs.create({
      clientId: client.id,
      tenantId,
      redirectUris: [...MCP_CLIENT_REDIRECT_URIS],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      audiences: [ADMIN_API_AUDIENCE],
      accessTokenTtlSeconds: MCP_CLIENT_LIFETIMES.accessToken,
      idTokenTtlSeconds: MCP_CLIENT_LIFETIMES.idToken,
      refreshTokenTtlSeconds: MCP_CLIENT_LIFETIMES.refreshToken,
      // What an agent may do as the person is shown to them, every time.
      consentRequired: true,
    });
  }
  return client;
}
