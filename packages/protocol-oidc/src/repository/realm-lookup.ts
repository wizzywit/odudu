import { realms, type Database } from '@odudu/db';
import { eq } from 'drizzle-orm';

export interface RealmLookup {
  id: string;
  enabled: boolean;
  // Read here, not just in @odudu/account's realmSettingsRepository,
  // because the login flow is what actually has to refuse to complete
  // until an unverified self-registered address is verified — see
  // #/usecase/login-submission.ts.
  verifyEmail: boolean;
  // The ceiling completeLogin passes to establishSession: the realm's own
  // configured value, not a package-wide constant.
  ssoSessionMaxSeconds: number;
  // The idle window resolveSessions checks a browser's sessions against
  // (sessionRepository(tx).liveByIds) — the realm's own configured value,
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
  // The three-state gate the registration endpoint and discovery's
  // registration_endpoint both read: 'disabled' answers neither, 'open'
  // and 'token' both advertise the endpoint and differ only in whether an
  // initial access token is required (ADR 0026).
  clientRegistrationPolicy: 'disabled' | 'open' | 'token';
}

export interface NewRealm {
  id: string;
  name: string;
  displayName?: string | null;
}

// Resolving {realm} from the request path happens before any realm context
// exists to `SET LOCAL app.realm_id` into, so `db` must be the owner
// connection (apps/server/src/app.ts's AppDeps.ownerDatabase), not the
// RLS-scoped serving one, which reads zero rows here. ADR 0009's amendment
// of 2026-09-13 has why that bypass is safe and why it is the only one.
export function realmLookupRepository(db: Database) {
  return {
    async byName(name: string): Promise<RealmLookup | null> {
      const rows = await db
        .select({
          id: realms.id,
          enabled: realms.enabled,
          verifyEmail: realms.verifyEmail,
          ssoSessionMaxSeconds: realms.ssoSessionMaxSeconds,
          ssoSessionIdleSeconds: realms.ssoSessionIdleSeconds,
          rememberMeIdleSeconds: realms.rememberMeIdleSeconds,
          rememberMeMaxSeconds: realms.rememberMeMaxSeconds,
          rememberMeAllowed: realms.rememberMeAllowed,
          clientRegistrationPolicy: realms.clientRegistrationPolicy,
        })
        .from(realms)
        .where(eq(realms.name, name));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        ...row,
        clientRegistrationPolicy:
          row.clientRegistrationPolicy as RealmLookup['clientRegistrationPolicy'],
      };
    },

    // The bootstrap seed command creates the first realm through this same
    // owner-connection bypass: `byName` above already establishes that no
    // realm context can exist before a realm is resolved, and creating one
    // is the other side of that same gap.
    async create(input: NewRealm): Promise<RealmLookup> {
      const rows = await db
        .insert(realms)
        .values({ id: input.id, name: input.name, displayName: input.displayName ?? null })
        .returning({
          id: realms.id,
          enabled: realms.enabled,
          verifyEmail: realms.verifyEmail,
          ssoSessionMaxSeconds: realms.ssoSessionMaxSeconds,
          ssoSessionIdleSeconds: realms.ssoSessionIdleSeconds,
          rememberMeIdleSeconds: realms.rememberMeIdleSeconds,
          rememberMeMaxSeconds: realms.rememberMeMaxSeconds,
          rememberMeAllowed: realms.rememberMeAllowed,
          clientRegistrationPolicy: realms.clientRegistrationPolicy,
        });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into realms returned no row');
      }
      return {
        ...row,
        clientRegistrationPolicy:
          row.clientRegistrationPolicy as RealmLookup['clientRegistrationPolicy'],
      };
    },
  };
}
