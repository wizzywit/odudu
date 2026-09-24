import { type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { OduduError } from '@odudu/kernel';
import { clientRepository } from '#/repository/clients';
import {
  ADMIN_CLIENT_ID,
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
} from '#/service/admin-capabilities';
import { provisionClientDefaults } from '#/usecase/provision-defaults';

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
  // Every capability role hangs off this client, and the disable, delete
  // and field guards all read builtin_admin — adopting a client that only
  // shares the client_id would leave all of them unprotected.
  if (existing !== null && !existing.builtinAdmin) {
    throw new OduduError(
      'admin_client_not_builtin',
      `client ${ADMIN_CLIENT_ID} already exists in this tenant and is not the built-in admin client`,
    );
  }
  let client = existing;
  if (client === null) {
    client = await clients.create({
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
    });
    // Without the tenant's standard vocabulary /authorize refuses `openid`,
    // which it defaults the requested scope to, on this client's very first
    // request. Only on the creating pass: the assignments are inserted
    // unconditionally, so a re-run would collide.
    await provisionClientDefaults(tx, client.id);
  }
  const clientDbId = client.id;

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
