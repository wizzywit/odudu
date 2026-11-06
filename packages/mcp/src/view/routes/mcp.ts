import { newId, tenantAddressOf, type TenantAddress } from '@odudu/kernel';
import { lifespansOf, type AdminPrincipal, type ForeignIssuer } from '@odudu/protocol-admin';
import { issuerBaseFor, MCP_READ_SCOPE } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { challengeFor, insufficientScope, invalidToken } from '#/service/challenge';
import type { McpLogger } from '#/service/deps';
import type { McpPrincipal, McpRequestInfo, OpenExchange } from '#/service/endpoint';
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_RATE_LIMITED,
  JSONRPC_SERVER_ERROR,
  jsonRpcError,
} from '#/service/jsonrpc-error';
import { hostAccepted, originAccepted } from '#/service/origin-policy';
import type { ToolLimiter } from '#/service/rate-limit';
import { validateMcpToken, type ValidateMcpTokenDeps } from '#/usecase/validate-mcp-token';

export const MCP_PATH_FORM = '/tenants/:tenant/mcp';

// A JSON-RPC request carrying a tool call is a few hundred bytes; this is
// room for a long argument and an envelope, and no room for a payload.
export const MCP_BODY_LIMIT_BYTES = 262_144;

// The rows a refusal leaves, written by the server that holds the database.
export interface McpRefusalAudit {
  foreignIssuer(tenantId: string, foreign: ForeignIssuer, request: McpRequestInfo): Promise<void>;
  agentWithoutScope(
    tenantId: string,
    principal: AdminPrincipal,
    request: McpRequestInfo,
  ): Promise<void>;
}

export interface McpRouteDeps {
  readonly auth: ValidateMcpTokenDeps;
  readonly adminAudience: string;
  readonly limiter: ToolLimiter;
  readonly audit: McpRefusalAudit;
  readonly open: OpenExchange;
  readonly now: () => Date;
  readonly logger: Pick<McpLogger, 'debug' | 'error'> & {
    warn(context: Record<string, unknown>, message: string): void;
  };
}

type McpRequest = FastifyRequest<{ Params: { tenant: string } }>;

interface Admitted {
  readonly principal: McpPrincipal;
  readonly info: McpRequestInfo;
}

const ADMITTED = new WeakMap<FastifyRequest, Admitted>();

function refuse(reply: FastifyReply, status: number, code: number, message: string): FastifyReply {
  return reply.code(status).header('cache-control', 'no-store').send(jsonRpcError(code, message));
}

function unauthorized(reply: FastifyReply, challenge: string): FastifyReply {
  return reply
    .code(401)
    .header('cache-control', 'no-store')
    .header('www-authenticate', challenge)
    .send();
}

async function recorded(
  deps: McpRouteDeps,
  what: string,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    deps.logger.error({ err: error }, `could not record ${what}`);
  }
}

// Everything a request must pass before its body is read, in the order the
// answer may not depend on: the host and origin it came to (which need no
// lookup), whether the tenant is served at all (answered as the protected
// resource metadata is, with nothing to tell an unknown tenant from a disabled
// one), then the token and the principal's budget.
async function admit(
  deps: McpRouteDeps,
  request: McpRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const address: TenantAddress = tenantAddressOf(request);
  if (!hostAccepted(request.host, address)) {
    return refuse(
      reply,
      403,
      JSONRPC_SERVER_ERROR,
      'Forbidden: this host does not serve the tenant',
    );
  }
  if (!originAccepted(request.headers.origin, address)) {
    return refuse(reply, 403, JSONRPC_SERVER_ERROR, 'Forbidden: origin not allowed');
  }

  const tenant = await deps.auth.findTenant(request.params.tenant);
  if (tenant?.enabled !== true) return reply.code(404).send();

  const info: McpRequestInfo = { requestId: newId(), ip: request.ip };
  reply.header('x-request-id', info.requestId);
  const outcome = await validateMcpToken(deps.auth, {
    authorizationHeader: request.headers.authorization,
    tenant: { id: tenant.id, name: request.params.tenant, lifespans: lifespansOf(tenant) },
    address,
    issuerBase: issuerBaseFor(request),
    adminAudience: deps.adminAudience,
    now: deps.now(),
  });

  if (outcome.kind === 'unauthenticated') {
    if (outcome.foreignIssuerError !== undefined) {
      deps.logger.error({ err: outcome.foreignIssuerError }, 'could not resolve a refused issuer');
    } else if (outcome.foreignIssuer !== undefined) {
      const foreign = outcome.foreignIssuer;
      await recorded(deps, 'a foreign issuer', () =>
        deps.audit.foreignIssuer(tenant.id, foreign, info),
      );
    } else {
      deps.logger.warn({ reason: outcome.reason }, 'mcp request unauthenticated');
    }
    return unauthorized(
      reply,
      outcome.reason === 'missing_credentials'
        ? challengeFor(address, MCP_READ_SCOPE)
        : invalidToken(address, MCP_READ_SCOPE),
    );
  }
  if (outcome.kind === 'insufficient_scope') {
    await recorded(deps, 'a token without an MCP scope', () =>
      deps.audit.agentWithoutScope(tenant.id, outcome.principal, info),
    );
    return reply
      .code(403)
      .header('cache-control', 'no-store')
      .header('www-authenticate', insufficientScope(address, [MCP_READ_SCOPE]))
      .send();
  }

  const { token, clientDbId } = outcome;
  const budget = deps.limiter.admit(token.tenant.id, `${token.subjectId}\u0000${token.clientId}`);
  if (!budget.admitted) {
    return reply
      .header('retry-after', String(budget.retryAfterSeconds))
      .code(429)
      .header('cache-control', 'no-store')
      .send(jsonRpcError(JSONRPC_RATE_LIMITED, 'Too many requests'));
  }
  reply.raw.once('close', budget.release);
  ADMITTED.set(request, { principal: { token, clientDbId }, info });
  return undefined;
}

async function serve(deps: McpRouteDeps, request: McpRequest, reply: FastifyReply) {
  const admitted = ADMITTED.get(request);
  if (admitted === undefined) throw new Error('an MCP request reached its handler unadmitted');
  // The SDK reads a batch as several requests, which would let one admitted
  // request spend many budgets; no revision since 2025-06-18 batches.
  if (Array.isArray(request.body)) {
    return refuse(reply, 400, JSONRPC_INVALID_REQUEST, 'Batch requests are not supported');
  }
  const { requestId } = admitted.info;
  reply.hijack();
  const res = reply.raw;
  res.setHeader('x-request-id', requestId);
  try {
    await deps.open(admitted.principal, admitted.info).serve(request.raw, res, request.body);
  } catch (error) {
    deps.logger.error({ err: error, requestId }, 'mcp request failed');
    if (res.headersSent) {
      res.end();
      return reply;
    }
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        jsonRpcError(JSONRPC_INTERNAL_ERROR, 'Internal error', { correlation_id: requestId }),
      ),
    );
  }
  return reply;
}

// The endpoint answers POST only: the 2026-07-28 revision keeps no session to
// open a stream on or end, and the 2025 handshake is served without one.
export function registerMcpRoute(app: FastifyInstance, deps: McpRouteDeps): void {
  app.route<{ Params: { tenant: string } }>({
    method: 'POST',
    url: MCP_PATH_FORM,
    bodyLimit: MCP_BODY_LIMIT_BYTES,
    onRequest: (request, reply) => admit(deps, request, reply),
    handler: (request, reply) => serve(deps, request, reply),
  });
  app.route({
    method: ['GET', 'DELETE'],
    url: MCP_PATH_FORM,
    // Answered before a body is read, so a DELETE that carries a content type
    // and no body is refused as what it is and not as a malformed document.
    onRequest: async (_request, reply) =>
      reply
        .code(405)
        .header('allow', 'POST')
        .send(jsonRpcError(JSONRPC_SERVER_ERROR, 'Method not allowed.')),
    handler: (_request, reply) => reply,
  });
}
