import {
  withSavepoint,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  createBrandingCache,
  publishedThemeRepository,
  resolveBranding,
  resolveMailBranding,
  type ResolveBrandingDeps,
} from '@odudu/domain-theme';
import { type MailThemeResolver } from '#/mail-look';
import { clientRepository } from '@odudu/domain-tenant';
import { systemClock, type BrandingResolver, type PageBranding } from '@odudu/kernel';
import { type Logger as PinoLogger } from 'pino';

export interface Branding {
  resolveBranding: BrandingResolver;
  // The tenant's theme as its mail wears it, read in the transaction the mail
  // is queued in; the page resolver's cache answers it when it can.
  resolveMailBranding: MailThemeResolver;
  // Whether a client_id is a registered client of the tenant, for the one
  // `return_to` an account page reads a client from.
  isClientOfTenant: (tenantId: string, clientId: string) => Promise<boolean>;
  // Drops the tenant's cached themes in this process; a publish, restore or
  // reset calls it. Another process shows the old theme for at most the
  // cache's ttl.
  invalidateTenant: (tenantId: string) => void;
}

// The theme resolver every page-serving route shares: one cache per process,
// reads through the tenant context, problems and template fallbacks to the
// server log. Without ODUDU_PUBLIC_BASE_URL no page is themed, since a
// theme's URLs are checked against the origin pages are served from.
export function createBranding(deps: {
  database: DatabaseHandle;
  logger: PinoLogger;
  publicBaseUrl: string | undefined;
}): Branding {
  const cache = createBrandingCache<PageBranding | null>({
    now: () => systemClock.now().getTime(),
  });
  const origin = deps.publicBaseUrl === undefined ? undefined : new URL(deps.publicBaseUrl).origin;
  const themeDeps: ResolveBrandingDeps = {
    readPublished: (tenantId, clientId) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        publishedThemeRepository(tx).forRender(tenantId, clientId),
      ),
    origin,
    now: () => systemClock.now().getTime(),
    cache,
    log: ({ scope, reason }) => {
      deps.logger.warn({ scope, reason }, 'a theme was not applied, the default page is shown');
    },
    reportFallback: ({ scope, kind, reason }) => {
      deps.logger.warn(
        { scope, kind, reason },
        'a theme template could not be filled, the default is used',
      );
    },
  };
  return {
    resolveBranding: resolveBranding(themeDeps),
    resolveMailBranding: resolveMailBranding(themeDeps, (tx: TenantScopedDatabase, tenantId) =>
      withSavepoint(tx, (inner) => publishedThemeRepository(inner).forRender(tenantId, null)),
    ),
    isClientOfTenant: (tenantId, clientId) =>
      withTenant(
        deps.database.db,
        tenantId,
        async (tx) => (await clientRepository(tx).byClientId(clientId)) !== null,
      ),
    invalidateTenant: (tenantId) => {
      cache.invalidateTenant(tenantId);
    },
  };
}
