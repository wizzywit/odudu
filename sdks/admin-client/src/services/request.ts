import type { ClientOptions } from '#/types';

export interface ResolvedOptions {
  baseUrl: string;
  tenant: string;
}

/** Refuses what would send a token somewhere unintended: a relative or non-http(s) base URL. */
export function resolveOptions(options: ClientOptions): ResolvedOptions {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    throw new TypeError('baseUrl must be an absolute http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('baseUrl must be an absolute http(s) URL');
  }
  if (!isSafeSegment(options.tenant)) {
    throw new TypeError(
      'tenant must be a name: not empty, not . or .., and without /, \\, % or control characters',
    );
  }
  return { baseUrl: options.baseUrl, tenant: options.tenant };
}

function isSafeSegment(value: string): boolean {
  if (value === '' || value === '.' || value === '..') return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x2f || code === 0x5c || code === 0x25) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A call may not choose its own origin, transport, redirect policy, middleware
// or path serializer: each would let it send the token somewhere else or skip
// the tenant. Authorization is set after the request is built, so a header the
// call names is replaced; an Idempotency-Key it names is the call's own key.
const CLIENT_OWNED = ['baseUrl', 'fetch', 'redirect', 'middleware', 'pathSerializer'];

function refuseDotSegments(path: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(path)) {
    if (value === '.' || value === '..') {
      throw new TypeError(`path parameter "${name}" must not be "." or ".."`);
    }
  }
}

/** Puts the client's tenant into a call's path parameters, over anything the call names. */
export function withTenant(init: unknown, tenant: string): Record<string, unknown> {
  const base = isRecord(init) ? init : {};
  const params = isRecord(base.params) ? base.params : {};
  const path = isRecord(params.path) ? params.path : {};
  refuseDotSegments(path);
  const kept = Object.entries(base).filter(([key]) => !CLIENT_OWNED.includes(key));
  return { ...Object.fromEntries(kept), params: { ...params, path: { ...path, tenant } } };
}

export function takesIdempotencyKey(
  method: string,
  schemaPath: string,
  operations: readonly string[],
): boolean {
  return operations.includes(`${method.toUpperCase()} ${schemaPath}`);
}
