import { type DatabaseHandle, withTenant } from '@odudu/db';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import {
  createInProcessCaller,
  exchangeForAdmin,
  scopeFor,
  ToolProblem,
  type McpCallDeps,
  type McpDeps,
  type ValidatedMcpToken,
  type AdminCaller,
} from '@odudu/mcp';
import { mintAgentToken, tenantLookupRepository } from '@odudu/protocol-oidc';
import { type FastifyInstance } from 'fastify';
import { type Logger as PinoLogger } from 'pino';

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
