import { type ChatDeps } from '@odudu/assistant';
import { type DatabaseHandle, withTenant } from '@odudu/db';
import {
  callMcpTool,
  createInProcessCaller,
  validatedMcpToken,
  type RegisteredTool,
  type ToolResult,
  type WriteBudget,
} from '@odudu/mcp';
import { recordAgentToolCall } from '@odudu/protocol-admin';
import { AGENT_TOKEN_MAX_TTL_SECONDS, type mintAgentToken } from '@odudu/protocol-oidc';
import { type FastifyInstance } from 'fastify';
import { type Logger as PinoLogger } from 'pino';
import { type ChatCaller } from '@odudu/assistant';
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

export interface AssistantIdentity {
  readonly clientId: string;
  readonly clientDbId: string;
}

// What one call acts on: the grant its token was minted against, the scope
// that token holds, the budget a write is reserved from and whether the token
// holds the write scope.
export interface CallAs {
  readonly grantId: string;
  readonly scope: readonly string[];
  readonly budget: WriteBudget;
  readonly holdsWrite: boolean;
}

// Runs one tool as the owner's agent, through the same bridge the MCP endpoint
// uses, and leaves the same row: a call whose row cannot be written does not
// return its data.
export async function callAsAssistant(
  parts: AssistantChatParts,
  caller: ChatCaller,
  as: CallAs,
  identity: AssistantIdentity,
  accessToken: string,
  tool: RegisteredTool,
  input: unknown,
): Promise<ToolResult> {
  const now = parts.now ?? (() => new Date());
  const { clientId, clientDbId } = identity;
  const token = validatedMcpToken({
    tenant: { id: caller.tenantId, name: caller.tenantName },
    issuer: caller.issuer,
    subjectId: caller.ownerSubjectId,
    clientId,
    grantId: as.grantId,
    scope: [...as.scope],
    expSeconds: Math.floor(now().getTime() / 1000) + AGENT_TOKEN_MAX_TTL_SECONDS,
  });
  const admin = createInProcessCaller(
    {
      inject: (options) => parts.app.inject(options),
      adminBearer: () => Promise.resolve(accessToken),
      requestId: caller.requestId,
      ip: caller.ip,
      adminHost: parts.publicBaseUrl === undefined ? undefined : new URL(parts.publicBaseUrl).host,
      logger: parts.logger,
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
      budget: as.budget,
      holdsWrite: as.holdsWrite,
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
}
