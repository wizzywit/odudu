import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  readAgentSettings,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import {
  requestRefusal,
  standingRefusal,
  type AgentTokenRefusal,
} from '#/service/agent-token-rules';
import { runInstanceId } from '#/service/agent-mint';
import { AGENT_TOKEN_MAX_TTL_SECONDS } from '#/service/mcp-scopes';
import { applyAgentLayer, isLive } from '#/usecase/agent-layer';
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
  // The `sub` of that token: the grant's owner must be this subject.
  readonly expectedSubjectId: string;
  // The OAuth `client_id` of the agent; it becomes `act.sub`.
  readonly agentClientId: string;
  readonly audience: string;
  readonly scope: readonly string[];
  // The presented MCP token's `exp`: a grant stores no per-token expiry.
  readonly notAfter: Date;
  readonly now: Date;
  // The agent's run (an assistant's conversation). For an agent-type client it
  // names the instance behind `act.sub`; the key is the run's, the parent an
  // instance of the same owner that started this one.
  readonly run?: { readonly key: string; readonly parentInstanceId?: string };
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

// The instance for one run of the owner's grant: the one the run's key already
// has, kept alive by this use, or a new one minted through the same agent layer
// an exchange uses. The grant row is locked first so two first calls with one
// key cannot both mint. A key whose instance has ended is spent and refused.
async function instanceForRun(
  tx: TenantScopedDatabase,
  deps: MintAgentTokenDeps,
  grant: TokenGrantRecord,
  client: ClientRecord,
  input: MintAgentTokenInput,
  instanceId: string,
): Promise<string | null> {
  const repo = agentInstanceRepository(tx);
  await repo.lockGrant(grant.id);
  const { agentInstanceIdleSeconds } = await readAgentSettings(tx, deps.tenantId);
  const session =
    grant.sessionId === null
      ? null
      : await sessionRepository(tx).liveById(grant.sessionId, deps.lifespans, input.now);

  const existing = await repo.lockForUpdate(instanceId);
  if (existing !== null) {
    if (!isLive(existing, input.now)) return null;
    // Only an instance with an idle expiry slides; a fixed-lifetime one is live
    // as it is and has nothing to extend.
    if (existing.idleExpiresAt !== null) {
      await repo.touch(
        existing.id,
        input.now,
        agentInstanceIdleSeconds,
        session?.expiresAt ?? existing.expiresAt,
      );
    }
    return existing.id;
  }

  const parent = input.run?.parentInstanceId;
  const layer = await applyAgentLayer(
    tx,
    { tenantId: deps.tenantId, lifespans: deps.lifespans },
    {
      client,
      agentType: true,
      subject: {
        subjectId: grant.subjectId,
        scope: grant.scope.split(' ').filter((entry) => entry !== ''),
        sessionId: grant.sessionId,
        grantId: grant.id,
        clientDbId: client.id,
        requestedUserinfoClaims: null,
        act: parent === undefined ? undefined : { sub: parent },
        mayAct: undefined,
        expiresAt: session?.expiresAt ?? null,
      },
      actorSubject: client.clientId,
      requestedScope: grant.scope.split(' ').filter((entry) => entry !== ''),
      now: input.now,
      run: { instanceId, idleSeconds: agentInstanceIdleSeconds },
    },
  );
  return layer.kind === 'ok' ? (layer.instance?.id ?? null) : null;
}

// The admin-audience token an agent acts with for the person whose grant it
// holds. Its only caller is the MCP layer, which has already validated the
// MCP-audience token; there is no client authentication and no /token
// request. The token carries the owner's grant id, so ending that grant,
// its session, the agent client or the subject ends the token with it (the
// admin API reads all four), and nothing is written. With a `run` and an agent
// type the instance for that run is written and its id is `act.sub`. An ended
// owner refuses a run 'owner_ended' after revoking its instance; only a caller
// that commits on a refusal keeps that write.
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
    expectedSubjectId: input.expectedSubjectId,
    scope: input.scope,
    grant,
    client,
    tenantEnabled: await tenantEnabledRepository(tx).enabled(deps.tenantId),
    sessionLive: await sessionLiveness(tx, deps, grant, input.now),
    subjectEnabled: await ownerEnabled(tx, grant),
  });
  const config =
    client === null ? null : await clientOidcConfigRepository(tx).byClientId(client.id);
  const runId =
    input.run !== undefined && grant !== null && config?.agentType === true
      ? runInstanceId(deps.tenantId, grant.id, input.run.key)
      : null;
  if (refusal !== null || grant === null || client === null) {
    if (runId !== null && (refusal === 'session_ended' || refusal === 'subject_disabled')) {
      await agentInstanceRepository(tx).revoke(runId, input.now);
      throw new AgentTokenRefused('owner_ended');
    }
    throw new AgentTokenRefused(refusal ?? 'grant_not_found');
  }

  let actSub = client.clientId;
  if (runId !== null) {
    const instance = await instanceForRun(tx, deps, grant, client, input, runId);
    if (instance === null) throw new AgentTokenRefused('run_refused');
    actSub = instance;
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
      act: { sub: actSub },
      endpointMinted: true,
      expCeiling: input.notAfter,
    },
    input.now,
  );
  return { accessToken, expiresAt: new Date(exp * 1000) };
}
