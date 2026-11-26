import {
  createChat,
  RunLapsed,
  type Chat,
  type ChatCaller,
  type ChatDeps,
  type RunTurnDeps,
} from '@odudu/assistant';
import { type DatabaseHandle, withTenant, withTenantRetrying } from '@odudu/db';
import { agentInstanceRepository, type AgentInstanceRecord } from '@odudu/domain-agents';
import { ADMIN_API_AUDIENCE, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  callMcpTool,
  createInProcessCaller,
  TOOLS,
  validatedMcpToken,
  type McpLogger,
  type WriteBudget,
} from '@odudu/mcp';
import { recordAgentToolCall } from '@odudu/protocol-admin';
import {
  AGENT_TOKEN_MAX_TTL_SECONDS,
  AgentTokenRefused,
  AssistantGrantRefused,
  grantAssistantAccess,
  MCP_READ_SCOPE,
  mintAgentToken,
  recordAssistantRefusal,
  runInstanceId,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { type FastifyInstance } from 'fastify';
import { type Logger as PinoLogger } from 'pino';
import { TOOL_DEADLINE_MS } from '#/mcp-deps';

export interface AssistantChatParts {
  readonly app: Pick<FastifyInstance, 'inject'>;
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly claimMappers: Parameters<typeof mintAgentToken>[1]['claimMappers'];
  readonly logger: PinoLogger;
  readonly publicBaseUrl: string | undefined;
  /** The model a slot runs; the provider's key is read where it is built, not here. */
  readonly models: ChatDeps['model'];
  readonly now?: () => Date;
}

// The assistant offers reads only, so no call has a change to reserve.
const NO_WRITES: WriteBudget = {
  reserve: () => Promise.resolve(false),
  release: () => Promise.resolve(),
};

interface Identity {
  readonly clientId: string;
  readonly clientDbId: string;
}

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

// Runs one tool as the owner's agent, through the same bridge the MCP endpoint
// uses, and leaves the same row: a call whose row cannot be written does not
// return its data.
function toolRunner(parts: AssistantChatParts, caller: ChatCaller, conversationId: string) {
  const now = parts.now ?? (() => new Date());
  const logger: McpLogger = parts.logger;
  let identity: Promise<Identity> | undefined;
  const identityOf = (): Promise<Identity> => {
    identity ??= withTenant(parts.database.db, caller.tenantId, async (tx) => {
      const grant = await tokenGrantRepository(tx).byId(conversationId);
      const client = grant === null ? null : await clientRepository(tx).byId(grant.clientId);
      if (client?.builtinAssistant !== true)
        throw new Error('the conversation has no assistant grant');
      return { clientId: client.clientId, clientDbId: client.id };
    });
    return identity;
  };
  return async (accessToken: string, name: string, input: unknown) => {
    const tool = TOOLS.find((entry) => entry.name === name);
    if (tool?.access !== 'read') throw new Error('not an assistant tool');
    const { clientId, clientDbId } = await identityOf();
    const token = validatedMcpToken({
      tenant: { id: caller.tenantId, name: caller.tenantName },
      issuer: caller.issuer,
      subjectId: caller.ownerSubjectId,
      clientId,
      grantId: conversationId,
      scope: [MCP_READ_SCOPE],
      expSeconds: Math.floor(now().getTime() / 1000) + AGENT_TOKEN_MAX_TTL_SECONDS,
    });
    const admin = createInProcessCaller(
      {
        inject: (options) => parts.app.inject(options),
        adminBearer: () => Promise.resolve(accessToken),
        requestId: caller.requestId,
        ip: caller.ip,
        adminHost:
          parts.publicBaseUrl === undefined ? undefined : new URL(parts.publicBaseUrl).host,
        logger,
      },
      token,
    );
    const principal = {
      subjectId: caller.ownerSubjectId,
      issuerTenantId: caller.tenantId,
      issuerTenantName: caller.tenantName,
      clientDbId,
      scopes: token.scope,
      agent: { clientId, ownerSubjectId: caller.ownerSubjectId },
    };
    return callMcpTool(
      {
        requestId: caller.requestId,
        deadlineMs: TOOL_DEADLINE_MS,
        budget: NO_WRITES,
        holdsWrite: false,
        record: (recorded) =>
          withTenant(parts.database.db, caller.tenantId, (tx) =>
            recordAgentToolCall(tx, principal, recorded),
          ),
        logger: parts.logger,
      },
      tool,
      admin,
      input,
    );
  };
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
    now: parts.now ?? (() => new Date()),
    newId,
    log: (event, detail) => {
      parts.logger.warn(detail, event);
    },
    turn: (caller, conversationId) => {
      const run = toolRunner(parts, caller, conversationId);
      return {
        mintToken: (key, signal) => unlessAborted(mint(caller, key), signal),
        callTool: (accessToken, name, input, signal) =>
          unlessAborted(run(accessToken, name, input), signal),
      };
    },
  });
}
