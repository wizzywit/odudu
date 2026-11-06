import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { expandPattern } from '#/service/admin-path';
import { accessOf, type AdminAccess } from '#/service/admin-access';
import type { McpLogger } from '#/service/deps';
import {
  ToolProblem,
  type AdminCaller,
  type AdminRequestSpec,
  type AdminResult,
} from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

// What a call may read back: the admin API's own page size bounds rows, not
// bytes, and a model reads whatever is returned.
export const ADMIN_BODY_CAP_BYTES = 1_048_576;

// What a tool may send: a description or a name is short, and the admin API
// has its own bound, so this is only a stop on what leaves this layer.
export const REQUEST_BODY_CAP_BYTES = 65_536;

const RETURNED_HEADERS = ['content-type', 'etag', 'retry-after'] as const;

export interface InProcessCallerDeps {
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
  // The bearer for a call of this access, minted or reused within the request.
  adminBearer(access: AdminAccess): Promise<string>;
  readonly requestId: string;
  readonly ip: string;
  // Left out, the issuer's own host.
  readonly adminHost: string | undefined;
  readonly logger: McpLogger;
}

function returnedHeaders(headers: LightMyRequestResponse['headers']): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of RETURNED_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') kept[name] = value;
  }
  return kept;
}

// The bytes of a request body, or nothing for a call without one. A body is a
// JSON record on a PATCH and nothing else.
function payloadOf(req: AdminRequestSpec): string | undefined {
  if (req.body === undefined) return undefined;
  if (req.method !== 'PATCH') throw new Error('only a PATCH carries a body');
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('a body is a JSON record');
  }
  const payload = JSON.stringify(req.body);
  if (Buffer.byteLength(payload) > REQUEST_BODY_CAP_BYTES) {
    throw new Error('the request body is too large');
  }
  return payload;
}

function bodyOf(res: LightMyRequestResponse): unknown {
  if (res.payload.length === 0) return null;
  if (!String(res.headers['content-type']).includes('json')) return null;
  try {
    const parsed: unknown = JSON.parse(res.payload);
    return parsed;
  } catch {
    return null;
  }
}

// Calls the admin API of this same app as the owner's agent. The request is
// built from fixed parts: the tenant is the token's, the path comes from a
// route pattern, and the only headers are the four set here (and a fixed content
// type with a body), so nothing a tool is given can add a header or a cookie.
export function createInProcessCaller(
  deps: InProcessCallerDeps,
  token: ValidatedMcpToken,
): AdminCaller {
  return {
    async call(req: AdminRequestSpec): Promise<AdminResult> {
      const url = expandPattern(req.pattern, token.tenant.name, req.params);
      const payload = payloadOf(req);
      const bearer = await deps.adminBearer(accessOf(req.method));
      const res = await deps.inject({
        method: req.method,
        url,
        query: { ...req.query },
        remoteAddress: deps.ip,
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: 'application/json',
          'x-request-id': deps.requestId,
          host: deps.adminHost ?? new URL(token.issuer).host,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(payload === undefined ? {} : { payload }),
      });
      deps.logger.debug(
        { method: req.method, pattern: req.pattern, status: res.statusCode },
        'admin call',
      );
      if (Buffer.byteLength(res.payload) > ADMIN_BODY_CAP_BYTES) {
        throw new ToolProblem('mcp:result_too_large', 'The result is too large to return', null);
      }
      return { status: res.statusCode, headers: returnedHeaders(res.headers), body: bodyOf(res) };
    },
  };
}
