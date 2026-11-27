import { isSystemTenantId } from '@odudu/domain-tenant';
export interface AgentReach {
  readonly agent: {
    readonly viaEndpoint?: true;
    // Set from the built-in assistant client's grant alone, when it names a tenant.
    readonly assistantTarget?: string;
  };
  readonly issuerTenantId: string;
  readonly pathTenantId: string;
  readonly pathTenantEnabled: boolean;
}

// Whether an agent token is admitted at the tenant a path names: the tenant that
// issued it, and nothing else, except the console assistant of a system
// administrator, whose grant (the built-in assistant client's) names one target.
// That token is admitted at that enabled target alone, with the endpoint marker
// and from the system tenant, whichever of the two scopes it holds: the write
// grant of one approved change names the target as the read grant does (ADR 0060).
// `authorizeAdmin` still checks what the administrator holds on every call.
export function agentReaches(reach: AgentReach): boolean {
  const target = reach.agent.assistantTarget;
  if (target === undefined) return reach.issuerTenantId === reach.pathTenantId;
  return (
    isSystemTenantId(reach.issuerTenantId) &&
    reach.agent.viaEndpoint === true &&
    target !== reach.issuerTenantId &&
    target === reach.pathTenantId &&
    reach.pathTenantEnabled
  );
}
