import createClient from 'openapi-fetch';
import { createTransport } from '#/adapter/transport';
import { requestHeaders } from '#/adapter/middleware';
import { IDEMPOTENT_OPERATIONS } from '#/generated/idempotent';
import { resolveOptions, withTenant } from '#/services/request';
import type { ClientOptions, TenantClient } from '#/types';

interface RawClient {
  request: (method: string, url: string, init: unknown) => Promise<unknown>;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `redirect: 'manual'` keeps a redirect from carrying the token to another
 * origin: the 3xx answer is returned to the caller as a `ProblemError`.
 */
export function createTenantClient<P extends object>(options: ClientOptions): TenantClient<P> {
  const { baseUrl, tenant } = resolveOptions(options);
  const send = options.fetch ?? ((input: Request) => globalThis.fetch(input));
  const inner = createClient<P>({
    baseUrl,
    redirect: 'manual',
    fetch: createTransport({ fetch: (request) => send(request), sleep: options.sleep ?? wait }),
  });
  inner.use(requestHeaders(options.token, IDEMPOTENT_OPERATIONS, () => crypto.randomUUID()));
  // openapi-fetch types each call by path; here the method is a runtime value.
  const raw = inner as unknown as RawClient;
  const call = (method: string) => async (url: string, init?: unknown) =>
    raw.request(method, url, withTenant(init, tenant));
  const surface = {
    GET: call('GET'),
    POST: call('POST'),
    PUT: call('PUT'),
    PATCH: call('PATCH'),
    DELETE: call('DELETE'),
  };
  return surface as unknown as TenantClient<P>;
}
