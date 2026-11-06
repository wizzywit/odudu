import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MCP_CLIENT_ID,
  SYSTEM_TENANT_NAME,
} from '@odudu/domain-tenant';
import { mcpAudienceOfIssuer, newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { seed, seedAdmin } from '#/cli/seed';

export interface World {
  readonly tenantId: string;
  readonly name: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly agentDbId: string;
  readonly adminDbId: string;
  readonly issuer: string;
}

// A tenant, a person holding `capabilities` on its admin client, a live session
// and a grant the built-in MCP client holds for them: what an MCP token stands on.
export async function mcpWorld(
  appDb: DatabaseHandle,
  base: string,
  capabilities: readonly string[],
  grantScope = 'mcp:read mcp:write',
): Promise<World> {
  const name = `mcp-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
  });
  return worldIn(appDb, base, { tenantId: seeded.tenantId, name }, capabilities, grantScope);
}

// The same, in the system tenant, which the first `seedAdmin` creates with its
// built-in clients and its `manage-tenants` role. The person is a new subject
// holding `capabilities`, not the administrator the seed made.
export async function mcpSystemWorld(
  appDb: DatabaseHandle,
  base: string,
  capabilities: readonly string[],
  grantScope = 'mcp:read mcp:write',
): Promise<World> {
  const admin = await seedAdmin({ username: `ops-${newId()}` });
  return worldIn(
    appDb,
    base,
    { tenantId: admin.tenantId, name: SYSTEM_TENANT_NAME },
    capabilities,
    grantScope,
  );
}

async function worldIn(
  appDb: DatabaseHandle,
  base: string,
  seeded: { readonly tenantId: string; readonly name: string },
  capabilities: readonly string[],
  grantScope: string,
): Promise<World> {
  const { name } = seeded;
  const issuer = `${base}/tenants/${name}`;
  return withTenant(appDb.db, seeded.tenantId, async (tx): Promise<World> => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const agent = await clientRepository(tx).byClientId(MCP_CLIENT_ID);
    if (admin === null || agent === null) throw new Error('the tenant has no built-in clients');
    const subject = await subjectRepository(tx).create({ tenantId: seeded.tenantId, type: 'user' });
    for (const capability of capabilities) {
      const role = await roleRepository(tx).byName(capability, admin.id);
      if (role === null) throw new Error(`no role ${capability}`);
      await roleRepository(tx).assignToSubject(subject.id, role.id);
    }
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId: seeded.tenantId,
      subjectId: subject.id,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: seeded.tenantId,
      clientId: agent.id,
      subjectId: subject.id,
      scope: grantScope,
      audience: [mcpAudienceOfIssuer(issuer)],
      sessionId,
    });
    return {
      tenantId: seeded.tenantId,
      name,
      subjectId: subject.id,
      sessionId,
      grantId,
      agentDbId: agent.id,
      adminDbId: admin.id,
      issuer,
    };
  });
}
