import { type DatabaseHandle, type RequestContext, withTenant } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  isSystemTenantId,
  readAgentSettings,
} from '@odudu/domain-tenant';
import {
  callMcpTool,
  createInProcessCaller,
  createMcpExchange,
  directCallerTools,
  exchangeForAdmin,
  newRequestScope,
  scopeFor,
  TOOLS,
  ToolProblem,
  visibleTools,
  type AdminCaller,
  type McpCallDeps,
  type McpDeps,
  type McpRouteDeps,
  type ToolLimiter,
  type ValidatedMcpToken,
  type WriteBudget,
} from '@odudu/mcp';
import {
  adminAuthDeps,
  heldCapabilities,
  recordAgentRefused,
  recordAgentToolCall,
  recordForeignIssuer,
  verifyTenantAccessToken,
} from '@odudu/protocol-admin';
import {
  agentBudgetRepository,
  AgentTokenRefused,
  MCP_WRITE_SCOPE,
  mintAgentToken,
  tenantLookupRepository,
  tokenGrantRepository,
} from '@odudu/protocol-oidc';
import { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { type Logger as PinoLogger } from 'pino';

// A tool that has not answered by now is given up on; the admin call it made
// is left to finish.
export const TOOL_DEADLINE_MS = 20_000;

export interface McpDepsParts {
  readonly app: Pick<FastifyInstance, 'inject'>;
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly claimMappers: Parameters<typeof mintAgentToken>[1]['claimMappers'];
  readonly logger: PinoLogger;
  readonly publicBaseUrl: string | undefined;
}

// What the MCP layer needs of this process: a way to sign the admin-audience
// token for an agent, and the app's own `inject` to call the admin API with it.
export function mcpDepsFor(parts: McpDepsParts): McpDeps {
  if (parts.publicBaseUrl === undefined) {
    parts.logger.warn(
      'ODUDU_PUBLIC_BASE_URL is not set: admin calls for MCP are addressed at the host of the ' +
        'token issuer, which a TLS-terminating proxy that rewrites the host would refuse',
    );
  }
  const lookup = tenantLookupRepository(parts.ownerDatabase.db);
  return {
    async mintAgentToken(token, input) {
      const tenant = await lookup.byName(token.tenant.name);
      if (tenant?.id !== token.tenant.id) {
        throw new ToolProblem('mcp:access_ended', 'The tenant is not available', 401);
      }
      // A refusal is returned out of the transaction so it commits: a run
      // whose owner ended has its instance revoked in that same transaction.
      const outcome = await withTenant(parts.database.db, tenant.id, async (tx) => {
        try {
          return await mintAgentToken(
            tx,
            {
              tenantId: tenant.id,
              issuer: token.issuer,
              kek: parts.kek,
              claimMappers: parts.claimMappers,
              lifespans: {
                ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
                ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
                rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
                rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
              },
            },
            input,
          );
        } catch (error) {
          if (error instanceof AgentTokenRefused) return error;
          throw error;
        }
      });
      if (outcome instanceof AgentTokenRefused) throw outcome;
      return outcome;
    },
    inject: (options) => parts.app.inject(options),
    now: () => new Date(),
    adminAudience: ADMIN_API_AUDIENCE,
    adminHost: parts.publicBaseUrl === undefined ? undefined : new URL(parts.publicBaseUrl).host,
    logger: parts.logger,
  };
}

// The caller a tool runs against for one MCP request: each admin request it
// makes is carried by the bearer this request's exchange yields for it.
export function adminCallerFor(deps: McpCallDeps, token: ValidatedMcpToken): AdminCaller {
  return createInProcessCaller(
    {
      inject: (options) => deps.inject(options),
      adminBearer: async (access) => {
        return (await exchangeForAdmin(deps, token, scopeFor(token, access))).bearer;
      },
      requestId: deps.request.requestId,
      ip: deps.request.ip,
      adminHost: deps.adminHost,
      logger: deps.logger,
    },
    token,
  );
}

// The write budget of the grant behind a token, spent in the database: the
// limits are the tenant's own settings, and a call counts at the grant and in
// the owner's daily window in one transaction, so calls made at once between
// them cannot pass a limit, in this process or another.
// A reservation waits for the grant's row no longer than the caller waits for it.
const LOCK_WAIT_MS = '3000';

const ENDED =
  'The grant behind this token is gone or was revoked: ask the person to sign in again.';

export function grantWriteBudget(
  database: DatabaseHandle,
  token: Pick<ValidatedMcpToken, 'tenant' | 'grantId'>,
  request?: RequestContext,
  logger?: Pick<PinoLogger, 'info'>,
  clock: () => Date = () => new Date(),
): WriteBudget {
  // The time each held reservation was spent at, so a release lands in the
  // daily window that was charged even when midnight UTC has passed since.
  const spentAt: Record<'mutating' | 'create', Date[]> = { mutating: [], create: [] };
  // The owner and the agent client the daily window is kept for are the grant's.
  const keysOf = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
    const grant = await tokenGrantRepository(tx).byId(token.grantId);
    if (grant === null)
      throw new ToolProblem('mcp:access_ended', 'The sign-in has ended', 401, ENDED);
    return { ownerSubjectId: grant.subjectId, agentClientId: grant.clientId };
  };
  return {
    reserve: (kind) =>
      withTenant(
        database.db,
        token.tenant.id,
        async (tx) => {
          await tx.execute(sql`select set_config('lock_timeout', ${LOCK_WAIT_MS}, true)`);
          const keys = await keysOf(tx);
          const settings = await readAgentSettings(tx, token.tenant.id);
          const now = clock();
          const outcome = await agentBudgetRepository(tx).spend({
            ...keys,
            grantId: token.grantId,
            instanceId: null,
            kind,
            now,
            limits: {
              grant: {
                mutating: settings.agentWritesPerGrant,
                creates: settings.agentCreatesPerGrant,
              },
              instanceSlice: null,
              windowWrites: settings.agentWindowWrites,
            },
          });
          if (outcome.kind === 'ok') {
            spentAt[kind].push(now);
            return true;
          }
          if (
            outcome.level === 'grant' &&
            !(await tokenGrantRepository(tx).isLive(token.grantId))
          ) {
            throw new ToolProblem('mcp:access_ended', 'The sign-in has ended', 401, ENDED);
          }
          logger?.info({ level: outcome.level, kind }, 'mcp write budget refused');
          return false;
        },
        request,
      ),
    release: (kind) =>
      withTenant(
        database.db,
        token.tenant.id,
        async (tx) =>
          agentBudgetRepository(tx).release({
            ...(await keysOf(tx)),
            grantId: token.grantId,
            instanceId: null,
            kind,
            now: spentAt[kind].pop() ?? clock(),
          }),
        request,
      ),
  };
}

// What the MCP route needs of this process beyond the exchange: the reads a
// token's holder is judged by (the admin API's own, shared), the rows a
// refusal and a tool call leave, and the exchange each request is served by.
export function mcpRouteDepsFor(parts: McpDepsParts, limiter: ToolLimiter): McpRouteDeps {
  const deps = mcpDepsFor(parts);
  const base = adminAuthDeps({
    database: parts.database,
    ownerDatabase: parts.ownerDatabase,
    publicBaseUrl: parts.publicBaseUrl,
  });
  const auth = {
    ...base,
    verifyAccessToken: (
      tenantId: string,
      token: string,
      expected: { readonly issuers: readonly string[]; readonly audience: string },
    ) => verifyTenantAccessToken(base, tenantId, token, expected),
  };
  const roles = {
    effectiveRoles: (tenantId: string, subjectId: string) =>
      withTenant(parts.database.db, tenantId, (tx) => effectiveRoles(tx, subjectId)),
  };
  return {
    auth,
    adminAudience: deps.adminAudience,
    addressConfigured: parts.publicBaseUrl !== undefined,
    limiter,
    now: deps.now,
    logger: parts.logger,
    audit: {
      foreignIssuer: (tenantId, foreign, request) =>
        withTenant(parts.database.db, tenantId, (tx) => recordForeignIssuer(tx, foreign), request),
      agentWithoutScope: (tenantId, principal, request) =>
        withTenant(
          parts.database.db,
          tenantId,
          (tx) => recordAgentRefused(tx, principal, 'agent_without_mcp_scope'),
          request,
        ),
    },
    open: ({ token, clientDbId }, request) => {
      const call: McpCallDeps = {
        ...deps,
        request: newRequestScope(request.requestId, request.ip),
      };
      const caller = adminCallerFor(call, token);
      const principal = {
        subjectId: token.subjectId,
        issuerTenantId: token.tenant.id,
        issuerTenantName: token.tenant.name,
        clientDbId,
        scopes: token.scope,
        agent: { clientId: token.clientId, ownerSubjectId: token.subjectId },
      };
      let held: Promise<ReadonlySet<string>> | undefined;
      const capabilities = (): Promise<ReadonlySet<string>> => {
        held ??= heldCapabilities(roles, token.tenant.id, token.subjectId);
        return held;
      };
      const ownerIsServiceAccount = (): Promise<boolean> =>
        withTenant(parts.database.db, token.tenant.id, async (tx) => {
          const client = await clientRepository(tx).byId(clientDbId);
          return client?.serviceSubjectId === token.subjectId;
        });
      return createMcpExchange({
        tenant: token.tenant.name,
        // A listing leaves out what the token or its owner could not use; a call
        // by name reaches the admin API for any tool, which refuses it, and one
        // row says so.
        tools: async (purpose) =>
          purpose === 'list'
            ? visibleTools(
                // A service account has no sign-in to count a create against.
                (await ownerIsServiceAccount()) ? directCallerTools(TOOLS) : TOOLS,
                token.scope,
                await capabilities(),
                isSystemTenantId(token.tenant.id),
              )
            : TOOLS,
        run: (tool, args) =>
          callMcpTool(
            {
              requestId: request.requestId,
              deadlineMs: TOOL_DEADLINE_MS,
              budget: grantWriteBudget(parts.database, token, request, parts.logger),
              holdsWrite: token.scope.includes(MCP_WRITE_SCOPE),
              record: (recorded) =>
                withTenant(
                  parts.database.db,
                  token.tenant.id,
                  (tx) => recordAgentToolCall(tx, principal, recorded),
                  request,
                ),
              logger: parts.logger,
            },
            tool,
            caller,
            args,
          ),
        onerror: (error) => {
          parts.logger.warn({ requestId: request.requestId, err: error }, 'mcp request rejected');
        },
      });
    },
  };
}
