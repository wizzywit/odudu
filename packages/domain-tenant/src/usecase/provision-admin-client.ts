import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { clientRepository } from '#/repository/clients';
import {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
} from '#/service/admin-capabilities';

export interface ProvisionAdminClientOptions {
  /** Adds `manage-tenants`. Only the system tenant asks for it. */
  readonly crossTenant?: boolean;
}

export interface ProvisionedAdminClient {
  readonly clientDbId: string;
}

/**
 * Idempotent: re-running adds what is missing and changes nothing else, so a
 * tenant provisioned before a capability existed gains it on the next pass.
 */
export async function provisionAdminClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  options: ProvisionAdminClientOptions = {},
): Promise<ProvisionedAdminClient> {
  const clients = clientRepository(tx);
  const existing = await clients.byClientId(ADMIN_CLIENT_ID);
  const created =
    existing ??
    (await clients.create({
      tenantId,
      clientId: ADMIN_CLIENT_ID,
      name: 'Odudu administration',
      // Public: an administrator authenticates as a subject through the
      // ordinary login flow, not this client through client_credentials, so
      // it carries no secret — clients_secret_matches_type (0004_clients.sql)
      // requires exactly that pairing for type = 'public'.
      type: 'public',
      secretHash: null,
      builtinAdmin: true,
    }));
  const clientDbId = created.id;

  const roles = roleRepository(tx);
  const ensure = async (name: string): Promise<string> => {
    const found = await roles.byName(name, clientDbId);
    if (found !== null) return found.id;
    const role = await roles.create({ tenantId, clientId: clientDbId, name });
    return role.id;
  };

  const composite = await ensure(TENANT_ADMIN);
  for (const capability of TENANT_CAPABILITIES) {
    const roleId = await ensure(capability);
    await roles.addComposite(composite, roleId);
    const view = viewCounterpart(capability);
    if (view !== null) await roles.addComposite(roleId, await ensure(view));
  }
  if (options.crossTenant === true) {
    await roles.addComposite(composite, await ensure(MANAGE_TENANTS));
  }
  return { clientDbId };
}
