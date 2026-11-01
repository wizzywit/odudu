import { canonicalLocale } from '@odudu/contracts';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { createBrandingCache } from '@odudu/domain-theme';
import { messageOverrideRepository } from '@odudu/domain-tenant';
import { systemClock, type OverridesResolver } from '@odudu/kernel';
import { type Logger as PinoLogger } from 'pino';
import { isOverridableMessageKey } from '#/theme-message-keys';

type OverrideMap = Readonly<Record<string, string>>;

// A tenant has at most 500 overrides across every locale, each at most 2,000
// characters, so one entry is bounded by what a tenant may store; the cache
// holds at most `maxEntries` of them and `maxBytes` of text, least recently
// used first out, each also gone after the ttl. A tenant with none is an
// entry too, which is what keeps a plain tenant's page render free of a query.
const CACHE = { maxEntries: 5000, ttlMs: 30_000, maxBytes: 8 * 1024 * 1024 } as const;

// Concurrent misses for one key share a read; past this many in flight a
// miss simply reads for itself.
export const MAX_OVERRIDE_READS_IN_FLIGHT = 256;
// A key whose read failed is not read again for this long, and at most this
// many keys are held so; the set is emptied when full.
export const OVERRIDE_BACKOFF_MS = 1000;
const MAX_BACKOFFS = 1024;
const MAX_ERROR_LENGTH = 200;

export interface MessageOverrides {
  resolveOverrides: OverridesResolver;
  // Drops the tenant's cached overrides in this process; a write calls it.
  // Another process shows the old text for at most the cache's ttl.
  invalidateTenant: (tenantId: string) => void;
}

export interface MessageOverridesDeps {
  read: (tenantId: string, locale: string) => Promise<OverrideMap>;
  now: () => number;
  log: (problem: { scope: string; reason: string }) => void;
}

function weigh(map: OverrideMap): number {
  let length = 256;
  for (const [key, message] of Object.entries(map))
    length += 2 * (key.length + message.length) + 64;
  return length;
}

// The tenant's own wording for one locale, never rejecting: whatever goes
// wrong, the page gets the catalogue's text and the log one line.
export function createMessageOverrides(deps: MessageOverridesDeps): MessageOverrides {
  const cache = createBrandingCache<OverrideMap>({ ...CACHE, now: deps.now });
  const inflight = new Map<string, Promise<OverrideMap>>();
  const failedUntil = new Map<string, { until: number; generation: number }>();

  async function fill(tenantId: string, locale: string, key: string): Promise<OverrideMap> {
    const generation = cache.generation(tenantId);
    try {
      const map = await deps.read(tenantId, locale);
      cache.set(key, tenantId, map, weigh(map), generation);
      return map;
    } catch (error) {
      const text = error instanceof Error ? error.message : 'unknown error';
      deps.log({
        scope: key,
        reason: `message overrides could not be read: ${text.slice(0, MAX_ERROR_LENGTH).replace(/\s+/gu, ' ')}`,
      });
      if (failedUntil.size >= MAX_BACKOFFS) failedUntil.clear();
      failedUntil.set(key, { until: deps.now() + OVERRIDE_BACKOFF_MS, generation });
      return {};
    }
  }

  const resolveOverrides: OverridesResolver = (tenantId, tag) => {
    const locale = canonicalLocale(tag);
    if (locale === null) return Promise.resolve({});
    const key = `${tenantId}:${locale}`;
    const held = cache.get(key);
    if (held !== undefined) return Promise.resolve(held.value);
    const backoff = failedUntil.get(key);
    if (
      backoff !== undefined &&
      deps.now() < backoff.until &&
      backoff.generation === cache.generation(tenantId)
    ) {
      return Promise.resolve({});
    }
    // Per tenant generation: a request after an invalidation starts its own
    // read rather than joining one that began before it.
    const flight = `${key}#${String(cache.generation(tenantId))}`;
    const running = inflight.get(flight);
    if (running !== undefined) return running;
    const started: Promise<OverrideMap> = fill(tenantId, locale, key).finally(() => {
      if (inflight.get(flight) === started) inflight.delete(flight);
    });
    if (inflight.size < MAX_OVERRIDE_READS_IN_FLIGHT) inflight.set(flight, started);
    return started;
  };

  return {
    resolveOverrides,
    invalidateTenant: (tenantId) => {
      cache.invalidateTenant(tenantId);
    },
  };
}

// The reader every page-serving route shares: one cache per process, reads
// through the tenant context, problems to the server log.
export function createDatabaseMessageOverrides(deps: {
  database: DatabaseHandle;
  logger: PinoLogger;
}): MessageOverrides {
  return createMessageOverrides({
    read: (tenantId, locale) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        messageOverrideRepository(tx, { isKnownKey: isOverridableMessageKey }).forRender(
          tenantId,
          locale,
        ),
      ),
    now: () => systemClock.now().getTime(),
    log: ({ scope, reason }) => {
      deps.logger.warn(
        { scope, reason },
        'message overrides were not applied, the catalogue is shown',
      );
    },
  });
}
