import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { isMcpScope } from '#/service/mcp-scopes';

export type AgentTokenRefusal =
  | 'audience_not_admin'
  | 'scope_not_mcp'
  | 'scope_widened'
  | 'token_expired'
  | 'grant_not_found'
  | 'grant_revoked'
  | 'grant_not_agent_client'
  | 'client_disabled'
  | 'tenant_disabled'
  | 'session_ended'
  | 'subject_disabled';

// What can be judged before anything is read.
export function requestRefusal(input: {
  readonly audience: string;
  readonly scope: readonly string[];
  readonly notAfter: Date;
  readonly now: Date;
}): AgentTokenRefusal | null {
  if (input.audience !== ADMIN_API_AUDIENCE) return 'audience_not_admin';
  if (input.scope.length === 0 || !input.scope.every(isMcpScope)) return 'scope_not_mcp';
  if (input.notAfter.getTime() <= input.now.getTime()) return 'token_expired';
  return null;
}

export interface AgentTokenGrounds {
  readonly tenantId: string;
  readonly scope: readonly string[];
  readonly grant: {
    readonly tenantId: string;
    readonly revokedAt: Date | null;
    readonly scope: string;
    readonly clientId: string;
  } | null;
  readonly client: { readonly id: string; readonly enabled: boolean } | null;
  readonly tenantEnabled: boolean;
  // Null where the grant is bound to no session.
  readonly sessionLive: boolean | null;
  readonly subjectEnabled: boolean;
}

// What must still stand about the grant, the agent, the tenant, the session
// and the owner, in the order a refusal names them.
export function standingRefusal(grounds: AgentTokenGrounds): AgentTokenRefusal | null {
  const { grant, client } = grounds;
  if (grant?.tenantId !== grounds.tenantId) return 'grant_not_found';
  if (grant.revokedAt !== null) return 'grant_revoked';
  const held = new Set(grant.scope.split(' '));
  if (!grounds.scope.every((entry) => held.has(entry))) return 'scope_widened';
  if (client?.enabled !== true) return 'client_disabled';
  if (grant.clientId !== client.id) return 'grant_not_agent_client';
  if (!grounds.tenantEnabled) return 'tenant_disabled';
  if (grounds.sessionLive === false) return 'session_ended';
  if (!grounds.subjectEnabled) return 'subject_disabled';
  return null;
}
