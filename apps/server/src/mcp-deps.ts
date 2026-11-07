import { type DatabaseHandle, type RequestContext, withTenant } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import { ADMIN_API_AUDIENCE, clientRepository, isSystemTenantId } from '@odudu/domain-tenant';
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
  WRITE_BUDGET,
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
import { mintAgentToken, tenantLookupRepository, tokenGrantRepository } from '@odudu/protocol-oidc';
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
      return withTenant(parts.database.db, tenant.id, (tx) =>
        mintAgentToken(
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
        ),
      );
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

// The write budget of the grant behind a token, spent in the database: one
// statement per reservation, so calls made at once between them cannot pass
// the limit, in this process or another.
// A reservation waits for the grant's row no longer than the caller waits for it.
const LOCK_WAIT_MS = '3000';

const ENDED =
  'The grant behind this token is gone or was revoked: ask the person to sign in again.';

export function grantWriteBudget(
  database: DatabaseHandle,
  token: Pick<ValidatedMcpToken, 'tenant' | 'grantId'>,
  request?: RequestContext,
): WriteBudget {
  return {
    reserve: (kind) =>
      withTenant(
        database.db,
        token.tenant.id,
        async (tx) => {
          await tx.execute(sql`select set_config('lock_timeout', ${LOCK_WAIT_MS}, true)`);
          const grants = tokenGrantRepository(tx);
          if (await grants.reserveAgentWrite(token.grantId, kind, WRITE_BUDGET)) return true;
          if (await grants.isLive(token.grantId)) return false;
          throw new ToolProblem('mcp:access_ended', 'The sign-in has ended', 401, ENDED);
        },
        request,
      ),
    release: (kind) =>
      withTenant(
        database.db,
        token.tenant.id,
        (tx) => tokenGrantRepository(tx).releaseAgentWrite(token.grantId, kind),
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
              budget: grantWriteBudget(parts.database, token, request),
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
