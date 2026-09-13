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
 * Every credential this server issues or accepts is a plaintext string that
 * TLS alone protects. RFC 6749 §3.1, §3.2 and §10.11 require the
 * authorization server to require TLS; Odudu terminates none, so the most it
 * can enforce in its own process is to refuse production traffic unless the
 * operator states that something in front of it does. It rests on two
 * operator assertions this process cannot check — `ODUDU_TLS` and
 * `NODE_ENV`, the second of which silences the guard outright. See
 * `docs/protocols/rfc6749.md`, "TLS: what a boot guard settles".
 */
export function assertProductionTls(config: Config): void {
  if (config.NODE_ENV === 'production' && !config.ODUDU_TLS) {
    throw new OduduError(
      'config_invalid',
      'ODUDU_TLS must be true when NODE_ENV=production. Every credential this server issues ' +
        'travels as plaintext over the connection, and TLS is the only thing protecting it — ' +
        'terminate TLS here or at a reverse proxy in front of this process, then set ' +
        'ODUDU_TLS=true (with ODUDU_TRUST_PROXY=true behind a proxy) to say so.',
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
