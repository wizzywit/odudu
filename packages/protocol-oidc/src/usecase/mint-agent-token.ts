import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { ADMIN_API_AUDIENCE, clientRepository } from '@odudu/domain-tenant';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import {
  requestRefusal,
  standingRefusal,
  type AgentTokenRefusal,
} from '#/service/agent-token-rules';
import { AGENT_TOKEN_MAX_TTL_SECONDS } from '#/service/mcp-scopes';
import { mintSubjectAccessToken, type AccessTokenDeps } from '#/usecase/token-issuance';

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

async function sessionLiveness(
  tx: TenantScopedDatabase,
  deps: MintAgentTokenDeps,
  grant: TokenGrantRecord | null,
  now: Date,
): Promise<boolean | null> {
  if (grant?.sessionId == null) return null;
  return (await sessionRepository(tx).liveById(grant.sessionId, deps.lifespans, now)) !== null;
}

async function ownerEnabled(tx: TenantScopedDatabase, grant: TokenGrantRecord | null) {
  return grant !== null && subjectIsEnabled(await subjectRepository(tx).byId(grant.subjectId));
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
  const early = requestRefusal(input);
  if (early !== null) throw new AgentTokenRefused(early);

  const grant = await tokenGrantRepository(tx).byId(input.subjectGrantId);
  const client = await clientRepository(tx).byClientId(input.agentClientId);
  const refusal = standingRefusal({
    tenantId: deps.tenantId,
    scope: input.scope,
    grant,
    client,
    tenantEnabled: await tenantEnabledRepository(tx).enabled(deps.tenantId),
    sessionLive: await sessionLiveness(tx, deps, grant, input.now),
    subjectEnabled: await ownerEnabled(tx, grant),
  });
  if (refusal !== null || grant === null || client === null) {
    throw new AgentTokenRefused(refusal ?? 'grant_not_found');
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
