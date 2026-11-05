import { CIMD_CACHE_MAX_ROWS, type CachedCimdDocument } from '#/repository/client-metadata-cache';
import { type CimdFetchOutcome, type CimdFetchRefusal } from '#/service/cimd-fetch-outcome';
import { parseCimdDocument, projectCimdDocument } from '#/service/client-id-metadata';

export interface ResolveCimdDeps {
  readonly cache: {
    find: (tenantId: string, url: string, now: Date) => Promise<CachedCimdDocument | null>;
    store: (
      tenantId: string,
      url: string,
      body: unknown,
      now: Date,
      expiresAt: Date,
      maxRows: number,
    ) => Promise<void>;
  };
  readonly fetch: (url: string) => Promise<CimdFetchOutcome>;
  readonly limiter: { tryAcquire: (tenantId: string, host: string) => boolean };
  readonly now: () => Date;
  readonly warn: (message: string, context: Record<string, string>) => void;
}

export type ResolveCimdOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'refused'; readonly reason: CimdFetchRefusal };

function codeOf(error: unknown): string {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

export async function resolveCimdDocument(
  tenantId: string,
  url: string,
  deps: ResolveCimdDeps,
): Promise<ResolveCimdOutcome> {
  const cached = await deps.cache.find(tenantId, url, deps.now());
  if (cached !== null && parseCimdDocument(url, cached.body).kind === 'ok') {
    return { kind: 'ok', body: cached.body };
  }
  const host = new URL(url).hostname;
  if (!deps.limiter.tryAcquire(tenantId, host)) {
    return { kind: 'refused', reason: 'rate_limited' };
  }

  const fetched = await deps.fetch(url);
  if (fetched.kind === 'refused') {
    return fetched;
  }
  const outcome = parseCimdDocument(url, fetched.body);
  if (outcome.kind !== 'ok') {
    return { kind: 'refused', reason: 'invalid_document' };
  }
  const projection = projectCimdDocument(outcome.client);
  if (fetched.cacheable) {
    // A document that cannot be kept is still served: the cache is an
    // optimisation, and its failure must not refuse a valid client. Only the
    // error's code is logged, since its message can carry the document.
    await deps.cache
      .store(tenantId, url, projection, deps.now(), fetched.expiresAt, CIMD_CACHE_MAX_ROWS)
      .catch((error: unknown) => {
        deps.warn('cimd cache store failed', { tenantId, host, code: codeOf(error) });
      });
  }
  return { kind: 'ok', body: projection };
}
