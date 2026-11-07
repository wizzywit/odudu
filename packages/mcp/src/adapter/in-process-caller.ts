import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { expandPattern } from '#/service/admin-path';
import {
  ADMIN_BODY_CAP_BYTES,
  createOnlyOf,
  idempotencyKeyOf,
  jsonBodyOf,
  payloadOf,
  preflight,
  preconditionOf,
  returnedHeaders,
} from '#/service/admin-request';
import { accessOf, type AdminAccess } from '#/service/admin-access';
import type { McpLogger } from '#/service/deps';
import {
  ToolProblem,
  type AdminCaller,
  type AdminRequestSpec,
  type AdminResult,
} from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

export { ADMIN_BODY_CAP_BYTES, REQUEST_BODY_CAP_BYTES } from '#/service/admin-request';

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

// Calls the admin API of this same app as the owner's agent. The request is
// built from fixed parts: the tenant is the token's, the path comes from a
// route pattern, and the only headers are the four set here (and a fixed content
// type with a body, `If-Match` for a validated etag, `If-None-Match: *` for a
// create-only PUT and `Idempotency-Key` for a validated key), so nothing a tool
// is given can add a header or a cookie.
export function createInProcessCaller(
  deps: InProcessCallerDeps,
  token: ValidatedMcpToken,
): AdminCaller {
  return {
    async call(req: AdminRequestSpec): Promise<AdminResult> {
      const { url, payload, ifMatch, createOnly, idempotencyKey } = preflight(() => ({
        url: expandPattern(req.pattern, token.tenant.name, req.params),
        payload: payloadOf(req),
        ifMatch: preconditionOf(req),
        createOnly: createOnlyOf(req),
        idempotencyKey: idempotencyKeyOf(req),
      }));
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
          ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
          ...(createOnly ? { 'if-none-match': '*' } : {}),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
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
      return {
        status: res.statusCode,
        headers: returnedHeaders(res.headers),
        body: jsonBodyOf(res.headers['content-type'], res.payload),
      };
    },
  };
}
