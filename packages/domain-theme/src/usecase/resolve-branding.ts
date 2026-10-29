import {
  createFallbackReporter,
  MAX_CLIENT_ID_LENGTH,
  type BrandingResolver,
  type BrandingScope,
  type MailBranding,
  type PageBranding,
  type TemplateFallback,
} from '@odudu/kernel';
import { type PublishedLayers } from '#/service/record';
import { type BrandingCache } from '#/service/branding-cache';
import { buildBranding } from '#/service/build-branding';

// Concurrent misses for one key share a read; past this many distinct keys
// in flight a miss simply reads for itself.
export const MAX_BRANDING_READS_IN_FLIGHT = 256;
// What the log has already heard, emptied when full, so a flood of distinct
// scopes costs a repeated line, never memory.
export const MAX_LOGGED_BRANDING_PROBLEMS = 1024;
// A key whose read failed is not read again for this long, and at most this
// many keys are held so; the set is emptied when full.
export const BRANDING_BACKOFF_MS = 1000;
export const MAX_BRANDING_BACKOFFS = 1024;
const MAX_ERROR_LENGTH = 200;

export interface BrandingProblem {
  scope: string;
  reason: string;
}

export interface ResolveBrandingDeps {
  readPublished(tenantId: string, oauthClientId: string | null): Promise<PublishedLayers>;
  // The origin pages are served from (ODUDU_PUBLIC_BASE_URL); none means no
  // page can be themed, since a theme's URLs are checked against it.
  origin: string | undefined;
  now(): number;
  // Keyed by tenant and client, not by version: a render learns the current
  // version only by reading, so an entry stands until a publish in this
  // process drops it (`invalidateTenant`) or its ttl ends, which is the
  // longest another process can show a replaced theme.
  cache: BrandingCache<PageBranding | null>;
  log(problem: BrandingProblem): void;
  reportFallback(entry: TemplateFallback): void;
}

// Rough weight of an entry, so a few large themes cannot fill the cache.
function weigh(branding: PageBranding | null): number {
  if (branding === null) return 256;
  const templates = Object.values(branding.branding.templates).reduce(
    (total, template) => total + template.length,
    0,
  );
  return 2 * (templates + branding.branding.tokensCss.length) + 2048;
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : 'unknown error';
  return text.slice(0, MAX_ERROR_LENGTH).replace(/\s+/gu, ' ');
}

// What a page is rendered with for a tenant and, when it has one, a client:
// the client's published pieces over the tenant's over the default, from one
// statement on a miss and none on a hit. It never rejects: whatever goes
// wrong, the page gets the default theme and the log one line.
export function resolveBranding(deps: ResolveBrandingDeps): BrandingResolver {
  return createResolvers(deps).page;
}

export interface MailScope {
  tenantId: string;
  tenantName: string;
  // The client the flow began inside, from server-side state only; the
  // reader decides whether it is a client whose theme a mail may wear.
  clientId?: string | null | undefined;
}

// How the published layers are read inside the caller's transaction: the
// tenant's alone for a null client, else the client's own over them.
export type ReadTenantLayer<Tx> = (
  tx: Tx,
  tenantId: string,
  clientId: string | null,
) => Promise<PublishedLayers>;

// The tenant's theme as its mail wears it, read through the transaction the
// mail is queued in rather than a second connection, so a burst of mail
// cannot hold every pooled connection while each waits for another. A hit in
// the page cache costs nothing; a miss is one statement and fills the cache
// for the pages too. It never rejects: a theme that cannot be read or built
// gives an unthemed mail, and a read that fails must be made in a savepoint by
// the caller, since a failed statement would abort the transaction otherwise.
export function resolveMailBranding<Tx>(
  deps: ResolveBrandingDeps,
  read: ReadTenantLayer<Tx>,
): (tx: Tx, scope: MailScope) => Promise<MailBranding | null> {
  const { mail } = createResolvers(deps);
  return (tx, scope) => mail((tenantId, clientId) => read(tx, tenantId, clientId), scope);
}

function createResolvers(deps: ResolveBrandingDeps): {
  page: BrandingResolver;
  mail: (
    read: (tenantId: string, clientId: string | null) => Promise<PublishedLayers>,
    scope: MailScope,
  ) => Promise<MailBranding | null>;
} {
  const report = createFallbackReporter((entry) => {
    deps.reportFallback(entry);
  });
  const heard = new Set<string>();
  // The generation is the tenant's when the read began: an invalidation
  // since then ends the backoff, so a publish is never held back by it.
  const failedUntil = new Map<string, { until: number; generation: number }>();
  const inflight = new Map<string, Promise<PageBranding | null>>();

  function note(scope: string, reason: string): void {
    const key = `${scope}\u0000${reason}`;
    if (heard.has(key)) return;
    if (heard.size >= MAX_LOGGED_BRANDING_PROBLEMS) heard.clear();
    heard.add(key);
    deps.log({ scope, reason });
  }

  async function fill(
    scope: BrandingScope,
    origin: string,
    key: string,
  ): Promise<PageBranding | null> {
    const generation = deps.cache.generation(scope.tenantId);
    let layers: PublishedLayers;
    try {
      layers = await deps.readPublished(scope.tenantId, scope.clientId);
    } catch (error) {
      note(key, `the theme could not be read: ${describe(error)}`);
      if (failedUntil.size >= MAX_BRANDING_BACKOFFS) failedUntil.clear();
      failedUntil.set(key, { until: deps.now() + BRANDING_BACKOFF_MS, generation });
      return null;
    }
    const built = buildBranding({
      tenantName: scope.tenantName,
      origin,
      layers: [
        ...(layers.client === null ? [] : [{ name: 'client' as const, layer: layers.client }]),
        ...(layers.tenant === null ? [] : [{ name: 'tenant' as const, layer: layers.tenant }]),
      ],
    });
    const value = settle(built, key, scope.tenantId, generation);
    return value;
  }

  function settle(
    built: ReturnType<typeof buildBranding>,
    key: string,
    tenantId: string,
    generation: number,
  ): PageBranding | null {
    const label = `${key}:${built.version}`;
    for (const reason of built.problems) note(label, reason);
    for (const { kind, reason } of built.refused) report(label)(kind, reason);
    const value =
      built.branding === null
        ? null
        : { branding: built.branding, templateFallback: report(label), mail: built.mail };
    deps.cache.set(key, tenantId, value, weigh(value), generation);
    return value;
  }

  async function guarded(
    scope: BrandingScope,
    origin: string,
    key: string,
  ): Promise<PageBranding | null> {
    try {
      return await fill(scope, origin, key);
    } catch (error) {
      deps.log({ scope: key, reason: `the theme could not be resolved: ${describe(error)}` });
      return null;
    }
  }

  // A client's mail is built from a read of its own and never from the page
  // cache: the reader answers for whether the client may brand a mail now
  // (still registered and enabled), which a cached page theme does not know.
  async function clientMail(
    read: (tenantId: string, clientId: string | null) => Promise<PublishedLayers>,
    scope: MailScope,
    clientId: string,
    origin: string,
  ): Promise<MailBranding | null | undefined> {
    const key = `${scope.tenantId}:${clientId}`;
    try {
      const layers = await read(scope.tenantId, clientId);
      const built = buildBranding({
        tenantName: scope.tenantName,
        origin,
        layers: [
          ...(layers.client === null ? [] : [{ name: 'client' as const, layer: layers.client }]),
          ...(layers.tenant === null ? [] : [{ name: 'tenant' as const, layer: layers.tenant }]),
        ],
      });
      for (const reason of built.problems) note(`${key}:${built.version}`, reason);
      return built.branding === null ? null : built.mail;
    } catch (error) {
      note(key, `the client theme could not be read for a mail: ${describe(error)}`);
      return undefined;
    }
  }

  async function mail(
    read: (tenantId: string, clientId: string | null) => Promise<PublishedLayers>,
    scope: MailScope,
  ): Promise<MailBranding | null> {
    if (deps.origin === undefined) {
      note('config', 'ODUDU_PUBLIC_BASE_URL is not set, so pages are not themed');
      return null;
    }
    const clientId = scope.clientId;
    if (clientId !== null && clientId !== undefined && clientId !== '') {
      if (clientId.length <= MAX_CLIENT_ID_LENGTH) {
        const own = await clientMail(read, scope, clientId, deps.origin);
        if (own !== undefined) return own;
      }
    }
    const key = `${scope.tenantId}:`;
    const held = deps.cache.get(key);
    if (held !== undefined) return held.value?.mail ?? null;
    const generation = deps.cache.generation(scope.tenantId);
    try {
      const layers = await read(scope.tenantId, null);
      const built = buildBranding({
        tenantName: scope.tenantName,
        origin: deps.origin,
        layers: layers.tenant === null ? [] : [{ name: 'tenant', layer: layers.tenant }],
      });
      return settle(built, key, scope.tenantId, generation)?.mail ?? null;
    } catch (error) {
      note(key, `the theme could not be read for a mail: ${describe(error)}`);
      return null;
    }
  }

  const page: BrandingResolver = (input) => {
    if (deps.origin === undefined) {
      note('config', 'ODUDU_PUBLIC_BASE_URL is not set, so pages are not themed');
      return Promise.resolve(null);
    }
    const clientId =
      input.clientId !== null &&
      input.clientId !== '' &&
      input.clientId.length <= MAX_CLIENT_ID_LENGTH
        ? input.clientId
        : null;
    const key = `${input.tenantId}:${clientId ?? ''}`;
    const held = deps.cache.get(key);
    if (held !== undefined) return Promise.resolve(held.value);
    const backoff = failedUntil.get(key);
    if (
      backoff !== undefined &&
      deps.now() < backoff.until &&
      backoff.generation === deps.cache.generation(input.tenantId)
    ) {
      return Promise.resolve(null);
    }
    // Per tenant generation: a request after an invalidation starts its own
    // read rather than joining one that began before it.
    const flight = `${key}#${String(deps.cache.generation(input.tenantId))}`;
    const running = inflight.get(flight);
    if (running !== undefined) return running;
    const started: Promise<PageBranding | null> = guarded(
      { ...input, clientId },
      deps.origin,
      key,
    ).finally(() => {
      if (inflight.get(flight) === started) inflight.delete(flight);
    });
    if (inflight.size < MAX_BRANDING_READS_IN_FLIGHT) inflight.set(flight, started);
    return started;
  };

  return { page, mail };
}
