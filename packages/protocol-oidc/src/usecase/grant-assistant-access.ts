import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  ASSISTANT_CLIENT_ID,
  clientRepository,
} from '@odudu/domain-tenant';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { tenantEnabledRepository } from '#/repository/tenant-enabled';
import {
  ASSISTANT_WRITE_CEILING,
  assistantGrantRefusal,
  reattachDecision,
  type ReattachDecision,
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
  const crossTarget = input.target != null && input.target.id !== deps.tenantId;
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
    ...(crossTarget && consoleGrant !== null
      ? { ownerCapabilities: await capabilitiesOf(tx, consoleGrant.subjectId) }
      : {}),
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

// What the owner holds on the admin client in their own tenant, read fresh.
async function capabilitiesOf(tx: TenantScopedDatabase, subjectId: string): Promise<string[]> {
  const roles = await effectiveRoles(tx, subjectId);
  return roles.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name);
}

export interface ReattachAssistantAccessInput extends Omit<
  GrantAssistantAccessInput,
  'newGrantId' | 'scope'
> {
  // The grant the conversation acted under until now.
  readonly previousGrantId: string;
  readonly newGrantId: string;
  readonly archived: boolean;
}

export type ReattachedAccess =
  | { readonly kind: 'live' }
  | {
      readonly kind: 'reattached';
      readonly grant: TokenGrantRecord;
      readonly previousGrantId: string;
    };

/**
 * What a message to a conversation needs under the console sign-in it arrived
 * on: nothing where its grant is live from this sign-in, otherwise a new grant
 * derived from this sign-in under every check `grantAssistantAccess` makes, with
 * the old grant ended so nothing it held carries over and the conversation never
 * holds two. A refusal throws `AssistantGrantRefused` and writes nothing. The
 * caller locks the conversation's row, so two messages at once make one grant.
 */
export async function reattachAssistantAccess(
  tx: TenantScopedDatabase,
  deps: GrantAssistantAccessDeps,
  input: ReattachAssistantAccessInput,
): Promise<ReattachedAccess> {
  const grants = tokenGrantRepository(tx);
  const decision = await reattachDecisionFor(tx, input);
  if (decision.kind === 'live') return { kind: 'live' };
  if (decision.kind === 'refused') throw new AssistantGrantRefused(decision.reason);
  const grant = await grantAssistantAccess(tx, deps, {
    newGrantId: input.newGrantId,
    consoleGrantId: input.consoleGrantId,
    expectedSubjectId: input.expectedSubjectId,
    mode: input.mode,
    now: input.now,
    ...(input.target === undefined ? {} : { target: input.target }),
  });
  await grants.revoke(input.previousGrantId, input.now, 'reattached');
  return { kind: 'reattached', grant, previousGrantId: input.previousGrantId };
}

/**
 * The decision `reattachAssistantAccess` would act on, made without changing
 * anything: whether a message to the conversation would be answered, which the
 * conversation reopened after a sign-in reports as `continuable`.
 */
export async function reattachDecisionFor(
  tx: TenantScopedDatabase,
  input: Pick<
    ReattachAssistantAccessInput,
    'previousGrantId' | 'consoleGrantId' | 'expectedSubjectId' | 'archived'
  >,
): Promise<ReattachDecision> {
  const grants = tokenGrantRepository(tx);
  const previous = await grants.byId(input.previousGrantId);
  const parent =
    previous?.exchangedFromGrantId == null
      ? null
      : await grants.byId(previous.exchangedFromGrantId);
  const assistant = await clientRepository(tx).byClientId(ASSISTANT_CLIENT_ID);
  return reattachDecision({
    consoleGrantId: input.consoleGrantId,
    expectedSubjectId: input.expectedSubjectId,
    archived: input.archived,
    previous:
      previous === null
        ? null
        : {
            subjectId: previous.subjectId,
            isAssistantGrant: assistant !== null && previous.clientId === assistant.id,
            revokedAt: previous.revokedAt,
            exchangedFromGrantId: previous.exchangedFromGrantId,
          },
    parent:
      parent === null ? null : { revokedAt: parent.revokedAt, revokedCause: parent.revokedCause },
  });
}
