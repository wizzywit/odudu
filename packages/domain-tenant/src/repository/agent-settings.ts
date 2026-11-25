import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// The limits of the agent identity layer a tenant holds, read together so a
// caller admitting an instance or a write sees one consistent set.
export interface AgentSettings {
  readonly agentMaxDelegationDepth: number;
  readonly agentMaxChildren: number;
  readonly agentMaxLiveInstances: number;
  readonly agentInstanceTtlSeconds: number;
  readonly agentInstanceIdleSeconds: number;
  readonly agentApprovalTtlSeconds: number;
  readonly agentWritesPerGrant: number;
  readonly agentCreatesPerGrant: number;
  readonly agentWindowWrites: number;
}

export async function readAgentSettings(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<AgentSettings> {
  const rows = await tx
    .select({
      agentMaxDelegationDepth: tenants.agentMaxDelegationDepth,
      agentMaxChildren: tenants.agentMaxChildren,
      agentMaxLiveInstances: tenants.agentMaxLiveInstances,
      agentInstanceTtlSeconds: tenants.agentInstanceTtlSeconds,
      agentInstanceIdleSeconds: tenants.agentInstanceIdleSeconds,
      agentApprovalTtlSeconds: tenants.agentApprovalTtlSeconds,
      agentWritesPerGrant: tenants.agentWritesPerGrant,
      agentCreatesPerGrant: tenants.agentCreatesPerGrant,
      agentWindowWrites: tenants.agentWindowWrites,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const row = rows[0];
  if (row === undefined)
    throw new Error(`tenant ${tenantId} not found while reading its agent settings`);
  return row;
}
