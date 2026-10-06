import { CLIENT_LIST_LIMIT, listLimitProblem } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  ADMIN_API_AUDIENCE,
  CONSOLE_CALLBACK_PATH,
  CONSOLE_POST_LOGOUT_PATH,
  provisionAdminClient as provisionClientAndRoles,
  type ProvisionAdminClientOptions as ClientAndRolesOptions,
  type ProvisionedAdminClient,
} from '@odudu/domain-tenant';
import { OduduError } from '@odudu/kernel';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

/**
 * The loopback redirect the built-in admin client is always provisioned
 * with, for an administrator with no console: RFC 8252 §7.3 makes a
 * loopback URI the right answer for a native tool, and redirect matching
 * is exact (`#/service/redirect-uri.ts`), so this port is the one such a
 * tool listens on. The console's own URIs are added beside it by
 * `registerConsoleUris`, under `ODUDU_PUBLIC_BASE_URL`.
 */
export const ADMIN_CLIENT_REDIRECT_URI = 'http://127.0.0.1:8080/callback';

export interface ProvisionAdminClientOptions extends ClientAndRolesOptions {
  /**
   * `ODUDU_PUBLIC_BASE_URL` while the console is on. Set, it replaces any
   * registered console URI with this base's, created row or existing;
   * unset, the registered URIs are left as they are.
   */
  readonly consoleBaseUrl?: string | undefined;
}

/**
 * The built-in admin client, whole: the client row and its capability
 * roles, which @odudu/domain-tenant owns, plus the OIDC configuration
 * without which /authorize refuses it, whose table belongs here. This is
 * the one every caller wants. Idempotent in both halves.
 */
export async function provisionAdminClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  options: ProvisionAdminClientOptions = {},
): Promise<ProvisionedAdminClient> {
  const provisioned = await provisionClientAndRoles(tx, tenantId, options);
  await provisionOidcConfig(tx, tenantId, provisioned.clientDbId);
  if (options.consoleBaseUrl !== undefined) {
    await registerConsoleUris(tx, provisioned.clientDbId, options.consoleBaseUrl);
  }
  return provisioned;
}

function hasPath(uri: string, path: string): boolean {
  return URL.canParse(uri) && new URL(uri).pathname === path;
}

function withConsoleUri(uris: readonly string[], path: string, baseUrl: string): string[] {
  return [...uris.filter((uri) => !hasPath(uri, path)), `${baseUrl}${path}`];
}

async function registerConsoleUris(
  tx: TenantScopedDatabase,
  clientDbId: string,
  baseUrl: string,
): Promise<void> {
  const repository = clientOidcConfigRepository(tx);
  const config = await repository.byClientId(clientDbId);
  if (config === null) throw new Error('the admin client has no OIDC configuration');
  const redirectUris = withConsoleUri(config.redirectUris, CONSOLE_CALLBACK_PATH, baseUrl);
  const postLogoutRedirectUris = withConsoleUri(
    config.postLogoutRedirectUris,
    CONSOLE_POST_LOGOUT_PATH,
    baseUrl,
  );
  for (const [field, list] of [
    ['redirect_uris', redirectUris],
    ['post_logout_redirect_uris', postLogoutRedirectUris],
  ] as const) {
    if (list.length > CLIENT_LIST_LIMIT) {
      throw new OduduError(
        'admin_client_list_full',
        `the built-in admin client's ${listLimitProblem(field, list.length)}: the console's URI cannot be added`,
      );
    }
  }
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  if (
    same(redirectUris, config.redirectUris) &&
    same(postLogoutRedirectUris, config.postLogoutRedirectUris)
  ) {
    return;
  }
  await repository.update(clientDbId, { redirectUris, postLogoutRedirectUris });
}

async function provisionOidcConfig(
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
    audiences: [ADMIN_API_AUDIENCE],
    // Its own, never the tenant's default: nobody may amend this client,
    // so a tenant raising its default must not lengthen admin tokens.
    accessTokenTtlSeconds: 300,
    idTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
}
