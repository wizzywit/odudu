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
// route pattern, and the only headers are the four set here, so nothing a
// tool is given can add a header, a cookie or a body.
export function createInProcessCaller(
  deps: InProcessCallerDeps,
  token: ValidatedMcpToken,
): AdminCaller {
  return {
    async call(req: AdminRequestSpec): Promise<AdminResult> {
      const url = expandPattern(req.pattern, token.tenant.name, req.params);
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
        },
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
