import { warnIfCookieFallbackActive } from '@odudu/authn-flows';
import { type Config, OduduError } from '@odudu/kernel';

/**
 * `ODUDU_DATABASE_URL` (the owner role) bypasses row-level security — see
 * ADR 0009. It exists to run migrations, not to serve traffic. Refusing to
 * boot in production without `ODUDU_APP_DATABASE_URL` keeps the RLS-bypassing
 * role from ever becoming the documented, load-bearing path.
 */
export function assertProductionAppDatabaseUrl(config: Config): void {
  if (config.NODE_ENV === 'production' && !config.ODUDU_APP_DATABASE_URL) {
    throw new OduduError(
      'config_invalid',
      'ODUDU_APP_DATABASE_URL is required when NODE_ENV=production. ODUDU_DATABASE_URL (the ' +
        'owner role, which bypasses row-level security) is for running migrations only — never ' +
        'for serving traffic.',
    );
  }
}

/**
 * `ODUDU_TLS=false` makes @odudu/authn-flows drop the `__Host-` cookie
 * prefix — a weaker mode meant for local development only. Wiring the
 * warning here, at boot, is what makes it noisy instead of silent.
 */
export function warnIfTlsDisabled(config: Config, log: (message: string) => void): void {
  warnIfCookieFallbackActive(config.ODUDU_TLS, log);
}
