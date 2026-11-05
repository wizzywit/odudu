import { type CimdFetchOutcome, type CimdFetchRefusal } from '#/service/cimd-fetch-outcome';
import { CIMD_CACHE_MAX_ROWS, type CachedCimdDocument } from '#/repository/client-metadata-cache';

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
  readonly now: () => Date;
}

export type ResolveCimdOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'refused'; readonly reason: CimdFetchRefusal };

export async function resolveCimdDocument(
  tenantId: string,
  url: string,
  deps: ResolveCimdDeps,
): Promise<ResolveCimdOutcome> {
  const cached = await deps.cache.find(tenantId, url, deps.now());
  if (cached !== null) return { kind: 'ok', body: cached.body };

  const fetched = await deps.fetch(url);
  if (fetched.kind === 'refused') return fetched;
  if (fetched.cacheable) {
    await deps.cache.store(
      tenantId,
      url,
      fetched.body,
      deps.now(),
      fetched.expiresAt,
      CIMD_CACHE_MAX_ROWS,
    );
  }
  return { kind: 'ok', body: fetched.body };
}
