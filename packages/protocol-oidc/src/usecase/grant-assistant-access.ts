import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { ADMIN_API_AUDIENCE, ASSISTANT_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import {
  ASSISTANT_WRITE_CEILING,
  assistantGrantRefusal,
  assistantScopeCeiling,
  type AssistantTargetFacts,
  type AssistantGrantRefusal,
  type AssistantMode,
} from '#/service/assistant-grant-rules';

export class AssistantGrantRefused extends Error {
  readonly reason: AssistantGrantRefusal;

  constructor(reason: AssistantGrantRefusal) {
    super(`assistant grant refused: ${reason}`);
    this.name = 'AssistantGrantRefused';
    this.reason = reason;
  }
}

export interface GrantAssistantAccessDeps {
  readonly tenantId: string;
  readonly lifespans: SessionLifespans;
}

export interface GrantAssistantAccessInput {
  // The id the conversation's grant is stored under; the caller names it so the
  // conversation can find its grant again without a column of its own.
  readonly newGrantId: string;
  // The grant behind the verified console token the request arrived on, never
  // a value from the request body.
  readonly consoleGrantId: string;
  // The `sub` of that token: the console grant's owner must be this subject.
  readonly expectedSubjectId: string;
  readonly mode: AssistantMode;
  // Defaults to the mode's ceiling; asking for more is refused.
  readonly scope?: readonly string[];
  readonly now: Date;
  // The tenant the conversation acts in, for a system administrator using the
  // assistant in another tenant, as the caller read its state there (this
  // transaction is bound to the administrator's own tenant and cannot see it):
  // the grant is stored under the administrator's tenant and names this one.
  // Left out, or equal to the administrator's tenant, it acts in its own.
  readonly target?: AssistantTargetFacts | null;
}

// Makes the grant a console assistant's conversation acts on: a grant of the
// built-in assistant client for the same subject and session as the console
// sign-in, exchanged from it, so ending the sign-in or its session ends the
// conversation with it. Its scope is the most the conversation may ever mint,
// and `mintAgentToken` refuses any token that asks for more. The console grant
// is read-locked first, so a revoke that commits meanwhile finds the new grant
// or leaves nothing to derive from.
export function grantAssistantAccess(
  tx: TenantScopedDatabase,
  deps: GrantAssistantAccessDeps,
  input: GrantAssistantAccessInput,
): Promise<TokenGrantRecord> {
  return deriveAssistantGrant(tx, deps, {
    ...input,
    scope: input.scope ?? assistantScopeCeiling(input.mode),
    ceiling: assistantScopeCeiling(input.mode),
  });
}

export interface GrantAssistantWriteInput {
  // The approval's own id, so one approval can make at most one grant.
  readonly approvalId: string;
  readonly consoleGrantId: string;
  readonly expectedSubjectId: string;
  readonly now: Date;
}

// The grant one approved write acts on: the console sign-in's subject and
// session, exchanged from it, holding `mcp:write` alone. It is made when the
// approval is spent and ended when the write returns, so the conversation's own
// read-only grant is never widened.
export function grantAssistantWrite(
  tx: TenantScopedDatabase,
  deps: GrantAssistantAccessDeps,
  input: GrantAssistantWriteInput,
): Promise<TokenGrantRecord> {
  return deriveAssistantGrant(tx, deps, {
    newGrantId: input.approvalId,
    consoleGrantId: input.consoleGrantId,
    expectedSubjectId: input.expectedSubjectId,
    mode: 'act',
    scope: ASSISTANT_WRITE_CEILING,
    ceiling: ASSISTANT_WRITE_CEILING,
    now: input.now,
  });
}

interface DerivedGrant extends Omit<GrantAssistantAccessInput, 'scope'> {
  readonly scope: readonly string[];
  readonly ceiling: readonly string[];
}

async function deriveAssistantGrant(
  tx: TenantScopedDatabase,
  deps: GrantAssistantAccessDeps,
  input: DerivedGrant,
): Promise<TokenGrantRecord> {
  const grants = tokenGrantRepository(tx);
  const clients = clientRepository(tx);
  const consoleGrant = await grants.byId(input.consoleGrantId);
  const consoleClient = consoleGrant === null ? null : await clients.byId(consoleGrant.clientId);
  const assistant = await clients.byClientId(ASSISTANT_CLIENT_ID);
  const assistantConfig =
    assistant === null ? null : await clientOidcConfigRepository(tx).byClientId(assistant.id);
  const session =
    consoleGrant?.sessionId == null
      ? null
      : await sessionRepository(tx).liveById(consoleGrant.sessionId, deps.lifespans, input.now);
  const { scope } = input;
  const refusal = assistantGrantRefusal({
    tenantId: deps.tenantId,
    expectedSubjectId: input.expectedSubjectId,
    scope,
    mode: input.mode,
    ceiling: input.ceiling,
    console: consoleGrant,
    consoleClient:
      consoleClient === null
        ? null
        : { id: consoleClient.id, builtinAdmin: consoleClient.builtinAdmin },
    assistantClient:
      assistant === null
        ? null
        : {
            enabled: assistant.enabled,
            builtinAssistant: assistant.builtinAssistant,
            agentType: assistantConfig?.agentType === true,
          },
    tenantEnabled: await tenantEnabledRepository(tx).enabled(deps.tenantId),
    ...(input.target === undefined ? {} : { target: input.target }),
    sessionLive: consoleGrant?.sessionId == null ? null : session !== null,
    subjectEnabled:
      consoleGrant !== null &&
      subjectIsEnabled(await subjectRepository(tx).byId(consoleGrant.subjectId)),
  });
  if (refusal !== null || consoleGrant === null || assistant === null) {
    throw new AssistantGrantRefused(refusal ?? 'grant_not_found');
  }
  if (!(await grants.lockLive(consoleGrant.id))) throw new AssistantGrantRefused('grant_revoked');
  return grants.create({
    id: input.newGrantId,
    tenantId: deps.tenantId,
    clientId: assistant.id,
    subjectId: consoleGrant.subjectId,
    scope: scope.join(' '),
    audience: [ADMIN_API_AUDIENCE],
    sessionId: consoleGrant.sessionId,
    exchangedFromGrantId: consoleGrant.id,
    ...(input.target == null || input.target.id === deps.tenantId
      ? {}
      : { targetTenantId: input.target.id }),
  });
}
