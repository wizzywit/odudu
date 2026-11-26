import { isSystemTenantId, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
export interface AgentReach {
  readonly agent: {
    readonly viaEndpoint?: true;
    // Set from the built-in assistant client's grant alone, when it names a tenant.
    readonly assistantTarget?: string;
  };
  readonly issuerTenantId: string;
  readonly scopes: readonly string[];
  readonly pathTenantId: string;
  readonly pathTenantEnabled: boolean;
}

// Whether an agent token is admitted at the tenant a path names. An agent acts
// in the tenant that issued its token and nowhere else. The one exception is
// the console assistant of a system administrator, whose grant names the tenant
// its conversation was created for: that token is admitted there and at no
// other tenant (the system tenant included), only when the grant is the
// built-in assistant client's (`assistantTarget` is set from that alone), the
// token carries the marker only the MCP endpoint signs, the issuer is the system
// tenant, the target is enabled and the token holds no write scope. What the
// administrator holds is still checked on every call by `authorizeAdmin`.
export function agentReaches(reach: AgentReach): boolean {
  const target = reach.agent.assistantTarget;
  if (target === undefined) return reach.issuerTenantId === reach.pathTenantId;
  return (
    isSystemTenantId(reach.issuerTenantId) &&
    reach.agent.viaEndpoint === true &&
    target !== reach.issuerTenantId &&
    target === reach.pathTenantId &&
    reach.pathTenantEnabled &&
    !reach.scopes.includes(MCP_WRITE_SCOPE)
  );
}
