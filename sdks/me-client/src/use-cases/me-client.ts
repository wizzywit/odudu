import { createTenantClient } from '#/repository/client';
import type { paths } from '#/generated/schema';
import type { ClientOptions, TenantClient } from '#/types';

/**
 * The signed-in person's own account in one tenant. `token` is an access token
 * whose audience is the tenant's `/me` URL. Paths are the document's, without
 * the tenant: `client.GET('/tenants/{tenant}/me/profile')`.
 */
export function createMeClient(options: ClientOptions): TenantClient<paths> {
  return createTenantClient<paths>(options);
}
