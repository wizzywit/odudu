import { relyingPartyId, warnIfCookieFallbackActive } from '@odudu/authn-flows';
import { type Config, OduduError } from '@odudu/kernel';

/**
 * `ODUDU_DATABASE_URL` is the owner role, which can switch row-level
 * security off on its own tables and escapes it outright where it is a
 * superuser — FORCE ROW LEVEL SECURITY (ADR 0009) removes the plain owner's
 * exemption but nothing can take ownership away. It exists to run
 * migrations, not to serve traffic, and refusing to boot in production
 * without `ODUDU_APP_DATABASE_URL` keeps it from becoming the documented,
 * load-bearing path.
 */
export function assertProductionAppDatabaseUrl(config: Config): void {
  if (config.NODE_ENV === 'production' && !config.ODUDU_APP_DATABASE_URL) {
    throw new OduduError(
      'config_invalid',
      'ODUDU_APP_DATABASE_URL is required when NODE_ENV=production. ODUDU_DATABASE_URL (the ' +
        'owner role, which can switch row-level security off) is for running migrations only — ' +
        'never for serving traffic.',
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
 * A passkey is bound to the relying party id it was registered against, and
 * that id comes from `ODUDU_PUBLIC_BASE_URL` alone — never from `Host` or
 * `X-Forwarded-Host`, which the client controls. A credential registered
 * against the wrong domain is unusable and silently so: the browser simply
 * never offers it. Since `configure-passkey` is reachable in every realm,
 * production boot refuses to proceed without a base URL a relying party id
 * can be derived from. Outside production the value stays optional and
 * passkey enrolment reports itself unsupported instead.
 */
export function assertProductionPasskeyRelyingParty(config: Config): void {
  if (config.NODE_ENV !== 'production') return;
  if (config.ODUDU_PUBLIC_BASE_URL === undefined) {
    throw new OduduError(
      'config_invalid',
      'ODUDU_PUBLIC_BASE_URL is required when NODE_ENV=production. It is the only source of the ' +
        'WebAuthn relying party id a passkey is registered against — a request header is ' +
        'client-controlled, and a passkey bound to the wrong domain is one the browser will ' +
        'never offer again.',
    );
  }
  // Derived here so a value the config schema accepts but no relying party
  // can come from fails at boot rather than at somebody's enrolment.
  relyingPartyId(config.ODUDU_PUBLIC_BASE_URL);
}

/**
 * `ODUDU_TLS=false` makes @odudu/authn-flows drop the `__Host-` cookie
 * prefix — a weaker mode meant for local development only. Wiring the
 * warning here, at boot, is what makes it noisy instead of silent.
 */
export function warnIfTlsDisabled(config: Config, log: (message: string) => void): void {
  warnIfCookieFallbackActive(config.ODUDU_TLS, log);
}
