import { type TenantScopedDatabase } from '@odudu/db';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

/**
 * The loopback redirect the built-in admin client is provisioned with.
 * There is no administration console and no configured base URL when the
 * client is created, and RFC 8252 §7.3 makes a loopback URI the right
 * answer for a native client — but redirect matching here is exact
 * (`#/service/redirect-uri.ts`), so this one port is the only one that
 * works until the console's own URI can be registered.
 */
export const ADMIN_CLIENT_REDIRECT_URI = 'http://127.0.0.1:8080/callback';

/**
 * The OIDC configuration of the built-in admin client, which
 * `provisionAdminClient` (@odudu/domain-tenant) cannot write itself
 * because the table belongs to this package. Idempotent: a client that
 * already has a configuration keeps it.
 */
export async function provisionAdminClientOidc(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientDbId: string,
): Promise<void> {
  const repository = clientOidcConfigRepository(tx);
  if ((await repository.byClientId(clientDbId)) !== null) return;

  await repository.create({
    clientId: clientDbId,
    tenantId,
    redirectUris: [ADMIN_CLIENT_REDIRECT_URI],
    // An administrator logs in as a subject and refreshes; the client
    // holds no secret, so it authenticates at /token with none.
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
}
