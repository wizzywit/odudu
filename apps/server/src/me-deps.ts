import { sessionRepository } from '@odudu/authn-flows';
import { type DatabaseHandle, withTenant } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { consentRepository } from '@odudu/domain-tenant';
import { type MeDeps, type MeReads } from '@odudu/me';
import { adminAuthDeps, verifyTenantAccessToken } from '@odudu/protocol-admin';
import { type Logger as PinoLogger } from 'pino';

export interface MeDepsParts {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly logger: PinoLogger;
  readonly publicBaseUrl: string | undefined;
}

// Each read runs in its own tenant-scoped transaction, so the tenant it names
// is the only one whose rows it can see.
export function meReadsFor(database: DatabaseHandle): MeReads {
  return {
    profile: (tenantId, subjectId) =>
      withTenant(database.db, tenantId, (tx) => userRepository(tx).bySubjectId(subjectId)),
    credentials: (tenantId, subjectId, page) =>
      withTenant(database.db, tenantId, async (tx) => {
        const credentials = credentialRepository(tx);
        return {
          rows: await credentials.summariesFor(subjectId, page),
          recoveryCodesLeft: await credentials.countUnspentRecoveryCodes(subjectId),
        };
      }),
    sessions: (tenantId, subjectId, lifespans, now, page) =>
      withTenant(database.db, tenantId, (tx) =>
        sessionRepository(tx).livePageBySubject(subjectId, lifespans, now, page),
      ),
    consents: (tenantId, subjectId, page) =>
      withTenant(database.db, tenantId, (tx) => consentRepository(tx).forSubject(subjectId, page)),
  };
}

// What the "me" routes need of this process: the reads the admin API's door
// judges a token by, shared, and the person's own reads.
export function meRouteDepsFor(parts: MeDepsParts): MeDeps {
  const base = adminAuthDeps({
    database: parts.database,
    ownerDatabase: parts.ownerDatabase,
    publicBaseUrl: parts.publicBaseUrl,
  });
  return {
    acceptedIssuers: base.acceptedIssuers,
    verifyAccessToken: (tenantId, token, expected) =>
      verifyTenantAccessToken(base, tenantId, token, expected),
    findTenant: async (name) => {
      const tenant = await base.findTenant(name);
      if (tenant === null) return null;
      return {
        id: tenant.id,
        enabled: tenant.enabled,
        lifespans: {
          ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
          ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
          rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
          rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
        },
      };
    },
    reads: meReadsFor(parts.database),
    now: () => new Date(),
    logger: parts.logger,
  };
}
