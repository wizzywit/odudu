import { tenantAddressOf } from '@odudu/kernel';
import { issuerBaseFor } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { McpLogger } from '#/service/deps';
import type { McpPrincipal, McpRequestInfo, OpenExchange } from '#/service/endpoint';
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_RATE_LIMITED,
  JSONRPC_SERVER_ERROR,
  jsonRpcError,
} from '#/service/jsonrpc-error';
import type { ToolLimiter } from '#/service/rate-limit';
import { newId } from '@odudu/kernel';
import { admitMcpRequest, type McpRefusalAudit } from '#/usecase/admit-mcp-request';
import type { ValidateMcpTokenDeps } from '#/usecase/validate-mcp-token';

export type { McpRefusalAudit };

export const MCP_PATH_FORM = '/tenants/:tenant/mcp';

// A JSON-RPC request carrying a tool call is a few hundred bytes; this is
// room for a long argument and an envelope, and no room for a payload.
export const MCP_BODY_LIMIT_BYTES = 262_144;

export interface McpRouteDeps {
  readonly auth: ValidateMcpTokenDeps;
  readonly adminAudience: string;
  // Whether the deployment states its public address, which the Host check
  // depends on.
  readonly addressConfigured: boolean;
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

// Maps what the admission decided to an answer; the decisions are the usecase's.
async function admit(
  deps: McpRouteDeps,
  request: McpRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const decision = await admitMcpRequest(
    { ...deps, newRequestId: newId },
    {
      host: request.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      tenantName: request.params.tenant,
      address: tenantAddressOf(request),
      issuerBase: issuerBaseFor(request),
      ip: request.ip,
    },
  );
  if (decision.kind === 'forbidden') {
    return refuse(
      reply,
      403,
      JSONRPC_SERVER_ERROR,
      'Forbidden: this host or origin is not the tenant’s',
    );
  }
  if (decision.kind === 'not_found') return reply.code(404).send();
  reply.header('x-request-id', decision.requestId).header('cache-control', 'no-store');
  if (decision.kind === 'unauthenticated') {
    return reply.code(401).header('www-authenticate', decision.challenge).send();
  }
  if (decision.kind === 'insufficient_scope') {
    return reply.code(403).header('www-authenticate', decision.challenge).send();
  }
  if (decision.kind === 'rate_limited') {
    return reply
      .header('retry-after', String(decision.retryAfterSeconds))
      .code(429)
      .send(jsonRpcError(JSONRPC_RATE_LIMITED, 'Too many requests'));
  }
  reply.raw.once('close', decision.release);
  ADMITTED.set(request, { principal: decision.principal, info: decision.info });
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
  const started = Date.now();
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
  // A hijacked reply skips Fastify's `onResponse`, where it logs a request as
  // completed, so the line is written here.
  request.log.info(
    { res: { statusCode: res.statusCode }, responseTime: Date.now() - started },
    'request completed',
  );
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
