import { createTenantClient } from '#/repository/client';
import type { paths } from '#/generated/schema';
import type { ClientOptions, TenantClient } from '#/types';

/**
 * The admin API of one tenant. Paths are the document's, without the tenant:
 * `client.GET('/admin/tenants/{tenant}/clients')`.
 */
export function createAdminClient(options: ClientOptions): TenantClient<paths> {
  return createTenantClient<paths>(options);
}
