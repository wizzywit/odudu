import {
  createChat,
  readSettings,
  toolsFor,
  deriveApprovalSecret,
  deriveDigestKey,
  type BudgetAuditEvent,
  type ConversationAuditEvent,
  type ConversationPorts,
  RunLapsed,
  type Chat,
  type ChatCaller,
  type ChatDeps,
  type RunTurnDeps,
  type TurnStart,
  type TurnSummary,
} from '@odudu/assistant';
import { auditRepository } from '@odudu/domain-audit';
import { withTenant, withTenantRetrying } from '@odudu/db';
import { agentInstanceRepository, type AgentInstanceRecord } from '@odudu/domain-agents';
import { ADMIN_API_AUDIENCE, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { TOOLS, type ToolResult, type WriteBudget } from '@odudu/mcp';
import {
  AGENT_TOKEN_MAX_TTL_SECONDS,
  AgentTokenRefused,
  AssistantGrantRefused,
  type AssistantTargetFacts,
  grantAssistantAccess,
  MCP_READ_SCOPE,
  mintAgentToken,
  recordAssistantRefusal,
  runInstanceId,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { callAsAssistant, type AssistantChatParts, type AssistantIdentity } from '#/assistant-call';
import { approvalPortsFor } from '#/assistant-approvals';

export type { AssistantChatParts } from '#/assistant-call';

// The assistant offers reads only, so no call has a change to reserve.
const NO_WRITES: WriteBudget = {
  reserve: () => Promise.resolve(false),
  release: () => Promise.resolve(),
};

// Gives up waiting for `work` when the turn is ended; the work itself is left to
// finish, as an admin call already sent is.
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  if (signal.aborted) return Promise.reject(new Error('the turn was ended'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error('the turn was ended'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

// An instance that ran out from idleness and was not revoked: the one refusal
// of a run that a next run answers. A hard expiry is the session's end and an
// owner who has gone, which a new instance would meet again.
function lapsedFromIdleness(instance: AgentInstanceRecord | null, at: Date): boolean {
  return (
    instance !== null &&
    instance.revokedAt === null &&
    instance.idleExpiresAt !== null &&
    instance.idleExpiresAt.getTime() <= at.getTime() &&
    instance.expiresAt.getTime() > at.getTime()
  );
}

// What the audit trail holds of a refusal: who, which client and a fixed code.
function auditRefusal(
  tx: Parameters<typeof grantAssistantAccess>[0],
  caller: ChatCaller,
  conversationId: string,
  refusal: string,
): Promise<void> {
  return recordAssistantRefusal(tx, {
    tenantId: caller.tenantId,
    subjectId: caller.ownerSubjectId,
    conversationId,
    refusal,
    ...(caller.target === undefined ? {} : { targetTenantId: caller.target.id }),
  });
}

/**
 * The token a turn's tool call acts with, for the conversation's run: the
 * same `act.sub` instance for every call of the run, however many are made at
 * once, since the mint locks the grant before it looks for the instance. The
 * run's `conversationId` is also the id of the grant `grantAssistantAccess`
 * made for it, so a call names no grant of its own: the one it acts on is the
 * conversation's, and only the assistant's client holds one. A run whose
 * instance lapsed from idleness throws `RunLapsed`, which moves the
 * conversation to its next run; any other refusal is the call's own.
 */
export function assistantTokenMint(
  parts: AssistantChatParts,
): (
  caller: ChatCaller,
  run: Parameters<RunTurnDeps['mintToken']>[0],
) => Promise<{ accessToken: string }> {
  const lookup = tenantLookupRepository(parts.ownerDatabase.db);
  const now = parts.now ?? (() => new Date());
  return async (caller, run) => {
    const tenant = await lookup.byName(caller.tenantName);
    if (tenant?.id !== caller.tenantId) throw new Error('the tenant is not available');
    const at = now();
    // A refusal is returned out of the transaction so it commits: a run whose
    // owner ended has its instance revoked in that same transaction, and the
    // refusal is audited in it.
    const outcome = await withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
      const grant = await tokenGrantRepository(tx).byId(run.conversationId);
      const client = grant === null ? null : await clientRepository(tx).byId(grant.clientId);
      const refused = async (error: AgentTokenRefused): Promise<'lapsed' | AgentTokenRefused> => {
        if (error.reason === 'run_refused') {
          const instance = await agentInstanceRepository(tx).byId(
            runInstanceId(tenant.id, run.conversationId, run.key),
          );
          if (lapsedFromIdleness(instance, at)) return 'lapsed';
        }
        await auditRefusal(tx, caller, run.conversationId, error.reason);
        return error;
      };
      if (client?.builtinAssistant !== true) {
        return refused(new AgentTokenRefused('grant_not_found'));
      }
      try {
        return await mintAgentToken(
          tx,
          {
            tenantId: tenant.id,
            issuer: caller.issuer,
            kek: parts.kek,
            claimMappers: parts.claimMappers,
            lifespans: {
              ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
              ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
              rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
              rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
            },
          },
          {
            subjectGrantId: run.conversationId,
            expectedSubjectId: caller.ownerSubjectId,
            agentClientId: client.clientId,
            audience: ADMIN_API_AUDIENCE,
            scope: [MCP_READ_SCOPE],
            notAfter: new Date(at.getTime() + AGENT_TOKEN_MAX_TTL_SECONDS * 1000),
            now: at,
            run: { key: run.key },
          },
        );
      } catch (error) {
        if (error instanceof AgentTokenRefused) return refused(error);
        throw error;
      }
    });
    if (outcome === 'lapsed') throw new RunLapsed();
    if (outcome instanceof AgentTokenRefused) {
      parts.logger.warn(
        {
          reason: outcome.reason,
          tenantId: tenant.id,
          ...(outcome.reason === 'run_refused' ? { hint: RUN_REFUSED_HINT } : {}),
        },
        'the assistant could not get a token for a tool call',
      );
      throw outcome;
    }
    return { accessToken: outcome.accessToken };
  };
}

// A run that did not lapse and was still refused: the agent layer turned it
// away. The cause an operator can fix is a `delegated_actors` list on the
// console client that does not name the assistant; otherwise a tenant limit on
// live instances or children was reached.
const RUN_REFUSED_HINT =
  'the agent layer refused the run: if the console client lists delegated_actors it must ' +
  'include odudu-assistant, otherwise a limit on live instances or children was reached';

// The read-only runner of a conversation: its own grant, `mcp:read`, no writes.
export function toolRunner(
  parts: AssistantChatParts,
  caller: ChatCaller,
  conversationId: string,
  turnId: string,
) {
  let identity: Promise<AssistantIdentity> | undefined;
  const identityOf = (): Promise<AssistantIdentity> => {
    identity ??= withTenant(parts.database.db, caller.tenantId, async (tx) => {
      const grant = await tokenGrantRepository(tx).byId(conversationId);
      const client = grant === null ? null : await clientRepository(tx).byId(grant.clientId);
      if (client?.builtinAssistant !== true)
        throw new Error('the conversation has no assistant grant');
      return { clientId: client.clientId, clientDbId: client.id };
    });
    return identity;
  };
  // Once a call's row could not be written, the turn's later calls are refused
  // before they run, so at most one read goes unrecorded in a turn.
  let unrecorded: ToolResult | undefined;
  return async (accessToken: string, name: string, input: unknown) => {
    const tool = toolsFor(TOOLS, caller).find((entry) => entry.name === name);
    if (tool?.access !== 'read') throw new Error('not an assistant tool');
    if (unrecorded !== undefined) return unrecorded;
    const result = await callAsAssistant(
      parts,
      caller,
      {
        grantId: conversationId,
        conversationId,
        turnId,
        scope: [MCP_READ_SCOPE],
        budget: NO_WRITES,
        holdsWrite: false,
      },
      await identityOf(),
      accessToken,
      tool,
      input,
    );
    if (notRecorded(result)) unrecorded = result;
    return result;
  };
}

function notRecorded(result: ToolResult): boolean {
  const { error } = result.structuredContent;
  return (
    result.isError &&
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'mcp:audit_unavailable'
  );
}

// What the budget leaves in the audit trail: who, which level and slot, and
// never the conversation's text. A write failing is the caller's to log.
function budgetAuditRecorder(parts: AssistantChatParts): NonNullable<ChatDeps['audit']> {
  return (event: BudgetAuditEvent) =>
    withTenantRetrying(parts.database.db, event.tenantId, (tx) =>
      auditRepository(tx).record({
        eventType: 'admin_mutation',
        action: 'assistant.budget',
        outcome: event.outcome,
        actorTenantId: event.tenantId,
        actorSubjectId: event.subjectId,
        resourceType: 'assistant_conversation',
        resourceId: event.conversationId,
        detail: {
          tenant: event.tenantId,
          ...(event.targetTenantId === undefined ? {} : { target_tenant: event.targetTenantId }),
          subject: event.subjectId,
          turn: event.turnId,
          slot: event.slot,
          ...(event.level === undefined ? {} : { level: event.level }),
          ...(event.stopReason === undefined ? {} : { stop_reason: event.stopReason }),
          ...(event.overrunTokens === undefined ? {} : { overrun_tokens: event.overrunTokens }),
        },
      }),
    );
}

// The `assistant.turn` rows: who, which conversation and turn, the profile and
// mode, the slots and, once it ends, the tokens, steps, reason and whether its
// trace is incomplete. Each is its own short transaction. Nothing here can carry
// message text, tool output or the name of a tenant object: the summary has no
// field for one.
export function turnAuditRecorder(
  parts: Pick<AssistantChatParts, 'database'>,
): Pick<ChatDeps, 'recordTurnStart' | 'recordTurn'> {
  const write = (
    phase: 'started' | 'ended',
    row: TurnStart,
    outcome: 'allowed' | 'refused' | 'failed',
    ended: Partial<Pick<TurnSummary, 'tokensBySlot' | 'steps' | 'stopReason' | 'traceLost'>>,
  ) =>
    withTenantRetrying(parts.database.db, row.tenantId, (tx) =>
      auditRepository(tx).record({
        eventType: 'admin_mutation',
        action: 'assistant.turn',
        outcome,
        actorTenantId: row.tenantId,
        actorSubjectId: row.subjectId,
        resourceType: 'assistant_conversation',
        resourceId: row.conversationId,
        detail: {
          phase,
          tenant: row.tenantId,
          ...(row.targetTenantId === undefined ? {} : { target_tenant: row.targetTenantId }),
          subject: row.subjectId,
          conversation: row.conversationId,
          turn: row.turnId,
          profile: row.profile,
          mode: row.mode,
          slots: [...row.slots],
          ...(ended.tokensBySlot === undefined ? {} : { tokens_by_slot: ended.tokensBySlot }),
          ...(ended.steps === undefined ? {} : { steps: ended.steps }),
          ...(ended.stopReason === undefined ? {} : { stop_reason: ended.stopReason }),
          ...(ended.traceLost === undefined ? {} : { trace_lost: ended.traceLost }),
        },
      }),
    );
  return {
    recordTurnStart: (start) => write('started', start, 'allowed', {}),
    recordTurn: (summary) => write('ended', summary, summary.outcome, summary),
  };
}

// What the tenant a system administrator names looks like from outside their
// own: whether it exists and is enabled, and whether it offers the assistant.
// Read in a transaction of its own, because the one that makes the grant is
// bound to the administrator's tenant and cannot see another's rows. The
// conversation's own checks then stand on these facts, and the door re-reads
// the tenant on every call. Undefined for a conversation in the caller's own tenant.
async function targetFacts(
  parts: AssistantChatParts,
  lookup: ReturnType<typeof tenantLookupRepository>,
  caller: ChatCaller,
): Promise<AssistantTargetFacts | null | undefined> {
  if (caller.target === undefined) return undefined;
  const found = await lookup.byName(caller.target.name);
  if (found?.id !== caller.target.id) return null;
  const settings = await withTenantRetrying(parts.database.db, found.id, (tx) =>
    readSettings(tx, found.id),
  );
  return { id: found.id, enabled: found.enabled, assistantEnabled: settings.assistant_enabled };
}

// Creates the conversation in a transaction of its own that begins with its
// grant, made from the console sign-in the request came on. The grant's id is
// the conversation's, so nothing else has to remember it. A refusal commits its
// audit row and nothing else.
function accessGranter(parts: AssistantChatParts): ChatDeps['withAccess'] {
  const lookup = tenantLookupRepository(parts.ownerDatabase.db);
  return async (caller, conversation, fn) => {
    const tenant = await lookup.byName(caller.tenantName);
    if (tenant?.id !== caller.tenantId) throw new Error('the tenant is not available');
    const target = await targetFacts(parts, lookup, caller);
    return withTenantRetrying(parts.database.db, tenant.id, async (tx) => {
      const refusal = async (reason: string) => {
        parts.logger.warn({ reason, tenantId: tenant.id }, 'the assistant was refused an identity');
        await auditRefusal(tx, caller, conversation.id, reason);
        return { kind: 'refused' as const, reason };
      };
      if (caller.grantId === undefined) return refusal('grant_not_found');
      try {
        await grantAssistantAccess(
          tx,
          {
            tenantId: tenant.id,
            lifespans: {
              ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
              ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
              rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
              rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
            },
          },
          {
            newGrantId: conversation.id,
            consoleGrantId: caller.grantId,
            expectedSubjectId: caller.ownerSubjectId,
            mode: conversation.mode,
            now: conversation.now,
            ...(target === undefined ? {} : { target }),
          },
        );
      } catch (error) {
        if (error instanceof AssistantGrantRefused) return refusal(error.reason);
        throw error;
      }
      return { kind: 'granted' as const, value: await fn(tx) };
    });
  };
}

// The rows a person's own deleting or exporting of a conversation leaves: who,
// which conversation, how much it held and, for a delete, the keyed digest of
// its messages. Written in the transaction of the delete or the read, so the
// two stand or fall together, and never with any of the text.
function conversationAuditRow(
  tx: Parameters<typeof grantAssistantAccess>[0],
  caller: ChatCaller,
  event: ConversationAuditEvent,
): Promise<void> {
  const common = {
    tenant: caller.tenantId,
    conversation: event.conversationId,
    ...(event.targetTenantId === undefined ? {} : { target_tenant: event.targetTenantId }),
  };
  return auditRepository(tx).record({
    eventType: 'admin_mutation',
    action: event.action,
    outcome: 'allowed',
    actorTenantId: caller.tenantId,
    actorSubjectId: caller.ownerSubjectId,
    resourceType: 'assistant_conversation',
    resourceId: event.conversationId,
    detail:
      event.action === 'assistant.conversation_deleted'
        ? {
            ...common,
            messages: event.messageCount,
            turns: event.turnCount,
            digest: event.digest,
          }
        : {
            ...common,
            format: event.format,
            messages: event.messageCount,
            truncated: event.truncated,
          },
  });
}

function conversationPorts(parts: AssistantChatParts): ConversationPorts {
  return {
    digestKey: deriveDigestKey(parts.kek),
    withAudit: (caller, fn) =>
      withTenantRetrying(parts.database.db, caller.tenantId, (tx) =>
        fn(tx, (event) => conversationAuditRow(tx, caller, event)),
      ),
    // The conversation's grant, and the instances rooted at it, end with it.
    endAccess: async (caller, conversationId, now) => {
      await withTenantRetrying(parts.database.db, caller.tenantId, (tx) =>
        tokenGrantRepository(tx).revoke(conversationId, now),
      );
    },
  };
}

// A message to a conversation is answered only while its grant is live and was
// made from the sign-in the caller holds now: a conversation of an earlier
// sign-in can be read and not continued.
function continuableCheck(parts: AssistantChatParts): NonNullable<ChatDeps['continuable']> {
  return (caller, conversationId) =>
    withTenantRetrying(parts.database.db, caller.tenantId, async (tx) => {
      const grant = await tokenGrantRepository(tx).byId(conversationId);
      return (
        grant !== null &&
        grant.revokedAt === null &&
        caller.grantId !== undefined &&
        grant.exchangedFromGrantId === caller.grantId
      );
    });
}

/** The assistant's chat, wired to this process: its database, its admin API and its models. */
export function assistantChatFor(parts: AssistantChatParts): Chat {
  const mint = assistantTokenMint(parts);
  return createChat({
    transact: (tenantId, fn) => withTenantRetrying(parts.database.db, tenantId, fn),
    model: parts.models,
    tools: TOOLS,
    instanceIdFor: (caller, conversationId, key) =>
      runInstanceId(caller.tenantId, conversationId, key),
    withAccess: accessGranter(parts),
    conversations: conversationPorts(parts),
    continuable: continuableCheck(parts),
    approvals: approvalPortsFor(parts),
    approvalSecret: deriveApprovalSecret(parts.kek),
    knownSecrets: parts.knownSecrets ?? [],
    now: parts.now ?? (() => new Date()),
    newId,
    audit: budgetAuditRecorder(parts),
    ...turnAuditRecorder(parts),
    log: (event, detail) => {
      parts.logger.warn(detail, event);
    },
    turn: (caller, conversationId, turnId) => {
      const run = toolRunner(parts, caller, conversationId, turnId);
      return {
        mintToken: (key, signal) => unlessAborted(mint(caller, key), signal),
        callTool: (accessToken, name, input, signal) =>
          unlessAborted(run(accessToken, name, input), signal),
      };
    },
  });
}
