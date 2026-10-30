import { tenants, type Database } from '@odudu/db';
import { refuseBidiControls, type PasswordRules } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

export interface TenantLookup {
  id: string;
  enabled: boolean;
  // Read here, not just in @odudu/account's tenantSettingsRepository,
  // because the login flow is what actually has to refuse to complete
  // until an unverified self-registered address is verified — see
  // #/usecase/login-submission.ts.
  verifyEmail: boolean;
  // The ceiling completeLogin passes to admitSession: the tenant's own
  // configured value, not a package-wide constant.
  ssoSessionMaxSeconds: number;
  // The idle window resolveSessions checks a browser's sessions against
  // (sessionRepository(tx).liveByEntries) — the tenant's own configured value,
  // mirroring ssoSessionMaxSeconds.
  ssoSessionIdleSeconds: number;
  // The remembered-login pair `lifespanFor` picks between alongside
  // ssoSessionIdleSeconds/ssoSessionMaxSeconds
  // (packages/authn-flows/src/service/session-lifespan.ts).
  rememberMeIdleSeconds: number;
  rememberMeMaxSeconds: number;
  // The authority login-submission.ts gates the login form's `remember_me`
  // field against: a request to remember a login is only ever honoured
  // when this is true, never on the field's say-so alone.
  rememberMeAllowed: boolean;
  // Whether the login form names an email address beside the username
  // (packages/db/drizzle/0083_login_with_email.sql).
  loginWithEmail: boolean;
  // Whether the sign-in page offers the self-registration and the password
  // reset pages. Those pages answer 404 on these same settings, so a link is
  // never shown that would lead nowhere.
  registrationAllowed: boolean;
  resetPasswordAllowed: boolean;
  // The cap admitSession (ADR 0033) evicts down to before inserting a new
  // session.
  maxSessionsPerBrowser: number;
  // The three-state gate the registration endpoint and discovery's
  // registration_endpoint both read: 'disabled' answers neither, 'open'
  // and 'token' both advertise the endpoint and differ only in whether an
  // initial access token is required (ADR 0026).
  clientRegistrationPolicy: 'disabled' | 'open' | 'token';
  // The languages the tenant's pages are offered in and, when it has set one,
  // the one used ahead of the browser's preference; discovery advertises the
  // list as `ui_locales_supported`.
  supportedLocales: string[];
  defaultLocale: string | null;
  // What the new-password pages tell a person about the password they
  // choose; the same row the lookup already reads.
  passwordRules: PasswordRules;
}

export interface NewTenant {
  id: string;
  name: string;
  displayName?: string | null;
}

const LOOKUP_COLUMNS = {
  id: tenants.id,
  enabled: tenants.enabled,
  verifyEmail: tenants.verifyEmail,
  ssoSessionMaxSeconds: tenants.ssoSessionMaxSeconds,
  ssoSessionIdleSeconds: tenants.ssoSessionIdleSeconds,
  rememberMeIdleSeconds: tenants.rememberMeIdleSeconds,
  rememberMeMaxSeconds: tenants.rememberMeMaxSeconds,
  rememberMeAllowed: tenants.rememberMeAllowed,
  loginWithEmail: tenants.loginWithEmail,
  registrationAllowed: tenants.registrationAllowed,
  resetPasswordAllowed: tenants.resetPasswordAllowed,
  maxSessionsPerBrowser: tenants.maxSessionsPerBrowser,
  clientRegistrationPolicy: tenants.clientRegistrationPolicy,
  supportedLocales: tenants.supportedLocales,
  defaultLocale: tenants.defaultLocale,
  passwordMinLength: tenants.passwordMinLength,
  passwordRequireDigit: tenants.passwordRequireDigit,
  passwordRequireUppercase: tenants.passwordRequireUppercase,
  passwordRequireLowercase: tenants.passwordRequireLowercase,
  passwordRequireSpecial: tenants.passwordRequireSpecial,
};

type LookupRow = {
  [K in keyof typeof LOOKUP_COLUMNS]: (typeof LOOKUP_COLUMNS)[K]['_']['notNull'] extends true
    ? (typeof LOOKUP_COLUMNS)[K]['_']['data']
    : (typeof LOOKUP_COLUMNS)[K]['_']['data'] | null;
};

function lookupOf(row: LookupRow): TenantLookup {
  const {
    passwordMinLength,
    passwordRequireDigit,
    passwordRequireUppercase,
    passwordRequireLowercase,
    passwordRequireSpecial,
    ...rest
  } = row;
  return {
    ...rest,
    clientRegistrationPolicy:
      row.clientRegistrationPolicy as TenantLookup['clientRegistrationPolicy'],
    passwordRules: {
      minLength: passwordMinLength,
      requireDigit: passwordRequireDigit,
      requireUppercase: passwordRequireUppercase,
      requireLowercase: passwordRequireLowercase,
      requireSpecial: passwordRequireSpecial,
    },
  };
}

// Resolving {tenant} from the request path happens before any tenant context
// exists to `SET LOCAL app.tenant_id` into, so `db` must be the owner
// connection (apps/server/src/app.ts's AppDeps.ownerDatabase), not the
// RLS-scoped serving one, which reads zero rows here. ADR 0009's amendment
// of 2026-09-13 has why that bypass is safe and why it is the only one.
export function tenantLookupRepository(db: Database) {
  return {
    async byName(name: string): Promise<TenantLookup | null> {
      const rows = await db.select(LOOKUP_COLUMNS).from(tenants).where(eq(tenants.name, name));
      const row = rows[0];
      if (row === undefined) return null;
      return lookupOf(row);
    },

    // The bootstrap seed command creates the first tenant through this same
    // owner-connection bypass: `byName` above already establishes that no
    // tenant context can exist before a tenant is resolved, and creating one
    // is the other side of that same gap.
    async create(input: NewTenant): Promise<TenantLookup> {
      refuseBidiControls('display_name', input.displayName);
      const rows = await db
        .insert(tenants)
        .values({ id: input.id, name: input.name, displayName: input.displayName ?? null })
        .returning(LOOKUP_COLUMNS);
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into tenants returned no row');
      }
      return lookupOf(row);
    },
  };
}
