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

export interface CapabilityRoleGraph {
  /** Every role on the built-in admin client, by name. */
  readonly roles: readonly string[];
  /** Each composite edge between them, as `[parent, child]`. */
  readonly composites: readonly (readonly [string, string])[];
}

/**
 * What `provisionAdminClient` creates on the built-in admin client, as
 * data: read by a tenant import to tell a capability role the new tenant
 * provisions from one a document would have to invent.
 */
export function capabilityRoleGraph(
  options: ProvisionAdminClientOptions = {},
): CapabilityRoleGraph {
  const composites: (readonly [string, string])[] = [];
  for (const capability of TENANT_CAPABILITIES) {
    composites.push([TENANT_ADMIN, capability]);
    const view = viewCounterpart(capability);
    if (view !== null) composites.push([capability, view]);
  }
  const crossTenant = options.crossTenant === true;
  if (crossTenant) composites.push([TENANT_ADMIN, MANAGE_TENANTS]);
  return {
    roles: [TENANT_ADMIN, ...TENANT_CAPABILITIES, ...(crossTenant ? [MANAGE_TENANTS] : [])],
    composites,
  };
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
  const graph = capabilityRoleGraph(options);
  const ids = new Map<string, string>();
  for (const name of graph.roles) {
    const found = await roles.byName(name, clientDbId);
    ids.set(name, found?.id ?? (await roles.create({ tenantId, clientId: clientDbId, name })).id);
  }
  for (const [parent, child] of graph.composites) {
    const parentId = ids.get(parent);
    const childId = ids.get(child);
    if (parentId === undefined || childId === undefined) {
      throw new Error(`capability role graph names ${parent} or ${child} without a role`);
    }
    await roles.addComposite(parentId, childId);
  }
  return { clientDbId };
}
