import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { isAdminRouteKey } from '#/service/agent-scope';
import { type AdminCapability } from '#/service/capability';
import {
  type AdminAgent,
  type AdminPrincipal,
  type ForeignIssuer,
} from '#/usecase/authenticate-admin';

export async function recordCapabilityRefused(
  tx: TenantScopedDatabase,
  principal: AdminPrincipal,
  capability: AdminCapability,
  alsoAdmits: readonly AdminCapability[] = [],
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'capability.refused',
    outcome: 'refused',
    actorTenantId: principal.issuerTenantId,
    actorSubjectId: principal.subjectId,
    actorClientId: principal.clientDbId,
    detail: {
      capability,
      ...(alsoAdmits.length === 0 ? {} : { also_admits: [...alsoAdmits] }),
      reason: 'missing_capability',
    },
  });
}

export async function recordAgentRefused(
  tx: TenantScopedDatabase,
  principal: AdminPrincipal,
  reason: 'agent_without_mcp_scope' | 'insufficient_scope',
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'capability.refused',
    outcome: 'refused',
    actorTenantId: principal.issuerTenantId,
    actorSubjectId: principal.subjectId,
    actorClientId: principal.clientDbId,
    detail: { reason },
  });
}

export async function recordForeignIssuer(
  tx: TenantScopedDatabase,
  foreign: ForeignIssuer,
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'token.foreign_issuer',
    outcome: 'refused',
    actorTenantId: foreign.issuerTenantId,
    actorSubjectId: foreign.subjectId,
    actorClientId: foreign.clientDbId,
    detail: { reason: 'foreign_issuer' },
  });
}

export interface AgentToolCall {
  readonly tool: string;
  readonly route: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly reason?:
    'insufficient_scope' | 'missing_capability' | 'timeout_outcome_unknown' | 'write_budget';
}

// Only the tool's name and the route it reached are recorded, never what it
// was called with: arguments and results may carry text an agent reads back.
export async function recordAgentToolCall(
  tx: TenantScopedDatabase,
  principal: AdminPrincipal & { readonly agent: AdminAgent },
  call: AgentToolCall,
): Promise<void> {
  if (!isAdminRouteKey(call.route)) {
    throw new Error('an agent tool call names an admin route that does not exist');
  }
  await auditRepository(tx).record({
    eventType: 'admin_access',
    action: 'agent.tool_call',
    outcome: call.outcome,
    actorTenantId: principal.issuerTenantId,
    actorSubjectId: principal.agent.ownerSubjectId,
    actorClientId: principal.clientDbId,
    detail: {
      agent_client: principal.clientDbId,
      owner: principal.agent.ownerSubjectId,
      tool: call.tool,
      route: call.route,
      ...(call.reason === undefined ? {} : { reason: call.reason }),
    },
  });
}
