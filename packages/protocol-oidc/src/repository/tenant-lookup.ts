import { tenants, type Database } from '@odudu/db';
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
  // The cap admitSession (ADR 0033) evicts down to before inserting a new
  // session.
  maxSessionsPerBrowser: number;
  // The three-state gate the registration endpoint and discovery's
  // registration_endpoint both read: 'disabled' answers neither, 'open'
  // and 'token' both advertise the endpoint and differ only in whether an
  // initial access token is required (ADR 0026).
  clientRegistrationPolicy: 'disabled' | 'open' | 'token';
}

export interface NewTenant {
  id: string;
  name: string;
  displayName?: string | null;
}

// Resolving {tenant} from the request path happens before any tenant context
// exists to `SET LOCAL app.tenant_id` into, so `db` must be the owner
// connection (apps/server/src/app.ts's AppDeps.ownerDatabase), not the
// RLS-scoped serving one, which reads zero rows here. ADR 0009's amendment
// of 2026-09-13 has why that bypass is safe and why it is the only one.
export function tenantLookupRepository(db: Database) {
  return {
    async byName(name: string): Promise<TenantLookup | null> {
      const rows = await db
        .select({
          id: tenants.id,
          enabled: tenants.enabled,
          verifyEmail: tenants.verifyEmail,
          ssoSessionMaxSeconds: tenants.ssoSessionMaxSeconds,
          ssoSessionIdleSeconds: tenants.ssoSessionIdleSeconds,
          rememberMeIdleSeconds: tenants.rememberMeIdleSeconds,
          rememberMeMaxSeconds: tenants.rememberMeMaxSeconds,
          rememberMeAllowed: tenants.rememberMeAllowed,
          maxSessionsPerBrowser: tenants.maxSessionsPerBrowser,
          clientRegistrationPolicy: tenants.clientRegistrationPolicy,
        })
        .from(tenants)
        .where(eq(tenants.name, name));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        ...row,
        clientRegistrationPolicy:
          row.clientRegistrationPolicy as TenantLookup['clientRegistrationPolicy'],
      };
    },

    // The bootstrap seed command creates the first tenant through this same
    // owner-connection bypass: `byName` above already establishes that no
    // tenant context can exist before a tenant is resolved, and creating one
    // is the other side of that same gap.
    async create(input: NewTenant): Promise<TenantLookup> {
      const rows = await db
        .insert(tenants)
        .values({ id: input.id, name: input.name, displayName: input.displayName ?? null })
        .returning({
          id: tenants.id,
          enabled: tenants.enabled,
          verifyEmail: tenants.verifyEmail,
          ssoSessionMaxSeconds: tenants.ssoSessionMaxSeconds,
          ssoSessionIdleSeconds: tenants.ssoSessionIdleSeconds,
          rememberMeIdleSeconds: tenants.rememberMeIdleSeconds,
          rememberMeMaxSeconds: tenants.rememberMeMaxSeconds,
          rememberMeAllowed: tenants.rememberMeAllowed,
          maxSessionsPerBrowser: tenants.maxSessionsPerBrowser,
          clientRegistrationPolicy: tenants.clientRegistrationPolicy,
        });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into tenants returned no row');
      }
      return {
        ...row,
        clientRegistrationPolicy:
          row.clientRegistrationPolicy as TenantLookup['clientRegistrationPolicy'],
      };
    },
  };
}
