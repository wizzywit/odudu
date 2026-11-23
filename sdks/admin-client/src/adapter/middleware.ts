import type { Middleware } from 'openapi-fetch';
import { takesIdempotencyKey } from '#/services/request';
import type { TokenSource } from '#/types';

async function resolveToken(token: TokenSource): Promise<string> {
  return typeof token === 'string' ? token : await token();
}

/** Signs each request with a fresh token and gives the calls the document marks an `Idempotency-Key`. */
export function requestHeaders(
  token: TokenSource,
  idempotent: readonly string[],
  newKey: () => string,
): Middleware {
  return {
    async onRequest({ request, schemaPath }) {
      request.headers.set('Authorization', `Bearer ${await resolveToken(token)}`);
      const wantsKey = takesIdempotencyKey(request.method, schemaPath, idempotent);
      if (wantsKey && !request.headers.has('Idempotency-Key')) {
        request.headers.set('Idempotency-Key', newKey());
      }
    },
  };
}
