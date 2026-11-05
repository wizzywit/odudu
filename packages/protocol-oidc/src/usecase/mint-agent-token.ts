import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { ADMIN_API_AUDIENCE, clientRepository } from '@odudu/domain-tenant';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import { tokenGrantRepository } from '#/repository/grants';
import { AGENT_TOKEN_MAX_TTL_SECONDS, isMcpScope } from '#/service/mcp-scopes';
import { mintSubjectAccessToken, type AccessTokenDeps } from '#/usecase/token-issuance';

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

// A refusal names its reason for a log and a test; the MCP layer answers its
// caller the same way whichever it was.
export class AgentTokenRefused extends Error {
  readonly reason: AgentTokenRefusal;

  constructor(reason: AgentTokenRefusal) {
    super(`agent token refused: ${reason}`);
    this.name = 'AgentTokenRefused';
    this.reason = reason;
  }
}

export interface MintAgentTokenDeps extends AccessTokenDeps {
  readonly tenantId: string;
  readonly lifespans: SessionLifespans;
}

export interface MintAgentTokenInput {
  // The owner's grant behind the MCP token the agent presented.
  readonly subjectGrantId: string;
  // The OAuth `client_id` of the agent; it becomes `act.sub`.
  readonly agentClientId: string;
  readonly audience: string;
  readonly scope: readonly string[];
  // The presented MCP token's `exp`: a grant stores no per-token expiry.
  readonly notAfter: Date;
  readonly now: Date;
}

// The admin-audience token an agent acts with for the person whose grant it
// holds. Its only caller is the MCP layer, which has already validated the
// MCP-audience token; there is no client authentication and no /token
// request. The token carries the owner's grant id, so ending that grant,
// its session, the agent client or the subject ends the token with it (the
// admin API reads all four), and nothing is written.
export async function mintAgentToken(
  tx: TenantScopedDatabase,
  deps: MintAgentTokenDeps,
  input: MintAgentTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const refuse = (reason: AgentTokenRefusal): AgentTokenRefused => new AgentTokenRefused(reason);

  if (input.audience !== ADMIN_API_AUDIENCE) throw refuse('audience_not_admin');
  if (input.scope.length === 0 || !input.scope.every(isMcpScope)) throw refuse('scope_not_mcp');
  if (input.notAfter.getTime() <= input.now.getTime()) throw refuse('token_expired');

  const grant = await tokenGrantRepository(tx).byId(input.subjectGrantId);
  if (grant?.tenantId !== deps.tenantId) throw refuse('grant_not_found');
  if (grant.revokedAt !== null) throw refuse('grant_revoked');

  const held = new Set(grant.scope.split(' '));
  if (!input.scope.every((entry) => held.has(entry))) throw refuse('scope_widened');

  const client = await clientRepository(tx).byClientId(input.agentClientId);
  if (client?.enabled !== true) throw refuse('client_disabled');
  if (grant.clientId !== client.id) throw refuse('grant_not_agent_client');

  if (!(await tenantEnabledRepository(tx).enabled(deps.tenantId))) {
    throw refuse('tenant_disabled');
  }
  if (
    grant.sessionId !== null &&
    (await sessionRepository(tx).liveById(grant.sessionId, deps.lifespans, input.now)) === null
  ) {
    throw refuse('session_ended');
  }
  if (!subjectIsEnabled(await subjectRepository(tx).byId(grant.subjectId))) {
    throw refuse('subject_disabled');
  }

  const { accessToken, exp } = await mintSubjectAccessToken(
    tx,
    deps,
    {
      subjectId: grant.subjectId,
      clientId: client.clientId,
      scope: [...input.scope],
      config: { accessTokenTtlSeconds: AGENT_TOKEN_MAX_TTL_SECONDS },
      audience: [ADMIN_API_AUDIENCE],
      fullScopeAllowed: client.fullScopeAllowed,
      sessionId: grant.sessionId,
      grantId: grant.id,
      act: { sub: client.clientId },
      expCeiling: input.notAfter,
    },
    input.now,
  );
  return { accessToken, expiresAt: new Date(exp * 1000) };
}
