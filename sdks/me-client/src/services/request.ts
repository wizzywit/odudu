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
  if (options.tenant === '') throw new TypeError('tenant must not be empty');
  return { baseUrl: options.baseUrl, tenant: options.tenant };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Puts the client's tenant into a call's path parameters, over anything the call names. */
export function withTenant(init: unknown, tenant: string): Record<string, unknown> {
  const base = isRecord(init) ? init : {};
  const params = isRecord(base.params) ? base.params : {};
  const path = isRecord(params.path) ? params.path : {};
  return { ...base, params: { ...params, path: { ...path, tenant } } };
}

export function takesIdempotencyKey(
  method: string,
  schemaPath: string,
  operations: readonly string[],
): boolean {
  return operations.includes(`${method.toUpperCase()} ${schemaPath}`);
}
