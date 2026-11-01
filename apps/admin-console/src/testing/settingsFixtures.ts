import { C, CLIENTS } from '#/testing/clientsFixtures';
import { json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
export const ST = `${ACME_ADMIN}/settings`;
export const SM = `${ACME_ADMIN}/smtp`;
export const MAIL = `${ACME_ADMIN}/mail`;

// What a tenant starts with: the migrations' own defaults.
export const SETTINGS = {
  display_name: 'Acme',
  enabled: true,
  registration_allowed: false,
  verify_email: false,
  reset_password_allowed: false,
  sso_session_idle_seconds: 1800,
  sso_session_max_seconds: 36000,
  password_min_length: 15,
  password_require_digit: false,
  password_require_uppercase: false,
  password_require_lowercase: false,
  password_require_special: false,
  password_not_username: true,
  password_not_email: true,
  password_history_depth: 0,
  password_max_age_days: 0,
  otp_required: false,
  brute_force_max_failures: 5,
  brute_force_lockout_seconds: 60,
  brute_force_max_lockout_seconds: 900,
  brute_force_failure_reset_seconds: 43200,
  client_registration_policy: 'disabled',
  max_clients: 200,
  max_sessions_per_browser: 25,
  remember_me_allowed: false,
  remember_me_idle_seconds: 604800,
  remember_me_max_seconds: 2592000,
  audit_retention_days: 90,
  username_editable: false,
  access_token_ttl_seconds: 300,
  id_token_ttl_seconds: 300,
  refresh_token_ttl_seconds: 1209600,
  authorization_code_ttl_seconds: 60,
  login_ttl_seconds: 1800,
  verify_email_ttl_seconds: 43200,
  reset_password_ttl_seconds: 300,
  login_with_email: false,
  audit_event_types: [
    'admin_mutation',
    'admin_access',
    'authentication',
    'session',
    'token',
    'credential',
  ],
  supported_locales: ['en'],
  default_locale: null,
};

export function settingsAnswer(changes: Record<string, unknown> = {}, etag = '"s1"'): Answer {
  return json({ ...SETTINGS, ...changes }, 200, { etag });
}

// grace of acme holding the capabilities given, with the settings above.
export function settingsRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${ST}`]: settingsAnswer(),
    },
    extra,
  );
}

export const NO_SMTP = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

export const OWN_SMTP = {
  configured: true,
  host: 'smtp.example',
  port: 587,
  from_address: 'noreply@example',
  username: 'mailer',
  password_set: true,
  starttls: true,
  effective: 'tenant',
};

export function smtpAnswer(config: Record<string, unknown> = OWN_SMTP, etag = '"m1"'): Answer {
  return json(config, 200, { etag });
}

export function mailMessage(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    to: 'a***@example.org',
    to_masked: true,
    subject: 'Verify your Acme account',
    status,
    attempts: status === 'queued' ? 0 : 1,
    last_error: null,
    created_at: '2026-10-12T08:00:00.000Z',
    next_attempt_at: '2026-10-12T08:05:00.000Z',
    sent_at: status === 'sent' ? '2026-10-12T08:01:00.000Z' : null,
    ...extra,
  };
}

// grace of acme holding the capabilities given, with a relay of its own and no mail.
export function emailRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${SM}`]: smtpAnswer(),
      [`GET ${MAIL}`]: json({ items: [] }),
      [`GET ${C}`]: json({ items: CLIENTS }),
    },
    extra,
  );
}
