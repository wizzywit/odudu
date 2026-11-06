import { randomUUID } from 'node:crypto';
import { boundedText } from '#/adapter/bounded-body';
import { accessOf } from '#/service/admin-access';
import { expandPattern } from '#/service/admin-path';
import {
  ADMIN_BODY_CAP_BYTES,
  jsonBodyOf,
  payloadOf,
  preconditionOf,
  returnedHeaders,
} from '#/service/admin-request';
import type { McpLogger } from '#/service/deps';
import { stdioTarget } from '#/service/stdio-target';
import type { TokenSource } from '#/service/token-source';
import {
  ToolProblem,
  type AdminCaller,
  type AdminRequestSpec,
  type AdminResult,
} from '#/service/tool';

export interface HttpCallerOptions {
  // The tenant the run was configured for; no tool input can name another.
  readonly tenant: string;
  readonly fetch?: typeof fetch;
  readonly requestId?: () => string;
  readonly timeoutMs?: number;
  readonly logger?: McpLogger;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SILENT: McpLogger = { debug: () => undefined, error: () => undefined };

function tooLarge(): ToolProblem {
  return new ToolProblem('mcp:result_too_large', 'The result is too large to return', null);
}

function unreachable(error: unknown): ToolProblem {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new ToolProblem('mcp:timeout', 'The admin API took too long to answer', 504);
  }
  return new ToolProblem('mcp:unreachable', 'The admin API could not be reached', 502);
}

// Calls the admin API of an instance over HTTP, as the person or service whose
// token the source holds. Like the in-process caller the request is built from
// fixed parts: the tenant is the configuration's, the path comes from a route
// pattern and the only headers are the ones set here. A redirect is never
// followed, since it would carry the bearer to wherever it points, and the
// bearer is in no log line or message.
export function createHttpCaller(
  baseUrl: string,
  tokens: TokenSource,
  options: HttpCallerOptions,
): AdminCaller {
  const target = stdioTarget(baseUrl, options.tenant);
  const send = options.fetch ?? fetch;
  const logger = options.logger ?? SILENT;
  const newRequestId = options.requestId ?? randomUUID;
  return {
    async call(req: AdminRequestSpec): Promise<AdminResult> {
      const path = expandPattern(req.pattern, options.tenant, req.params);
      const payload = payloadOf(req);
      const ifMatch = preconditionOf(req);
      const url = new URL(target.adminUrl(path));
      for (const [name, value] of Object.entries(req.query)) url.searchParams.append(name, value);
      const attempt = async (): Promise<{ res: Response; bearer: string }> => {
        const bearer = await tokens.bearer(accessOf(req.method));
        try {
          const res = await send(url, {
            method: req.method,
            headers: {
              authorization: `Bearer ${bearer}`,
              accept: 'application/json',
              'x-request-id': newRequestId(),
              ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
              ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
            },
            ...(payload === undefined ? {} : { body: payload }),
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          });
          return { res, bearer };
        } catch (error) {
          throw unreachable(error);
        }
      };
      // A 401 means the server no longer takes the token held (its grant ended,
      // or it lapsed early): another is got once, and what that gets is the answer.
      const first = await attempt();
      let res = first.res;
      if (res.status === 401 && tokens.invalidate !== undefined) {
        await res.body?.cancel();
        tokens.invalidate(first.bearer);
        res = (await attempt()).res;
      }
      logger.debug({ method: req.method, pattern: req.pattern, status: res.status }, 'admin call');
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        throw new ToolProblem(
          'mcp:redirect_refused',
          'The admin API answered with a redirect, which is not followed',
          502,
        );
      }
      const text = await boundedText(res, ADMIN_BODY_CAP_BYTES);
      if (text === undefined) throw tooLarge();
      return {
        status: res.status,
        headers: returnedHeaders(Object.fromEntries(res.headers)),
        body: jsonBodyOf(res.headers.get('content-type'), text),
      };
    },
  };
}
