import { enqueueVerificationLink, type MailGate } from '@odudu/account';
import {
  onSecondFactorRemoved,
  sessionRepository,
  tenantSettingsRepository,
} from '@odudu/authn-flows';
import {
  type DatabaseHandle,
  isUniqueViolation,
  tenants,
  type TenantScopedDatabase,
  withTenant,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { type MailLookResolver } from '@odudu/email';
import {
  credentialRepository,
  pendingEmailRepository,
  userRepository,
} from '@odudu/domain-identity';
import { clientRepository, consentRepository } from '@odudu/domain-tenant';
import {
  type MeDeps,
  type MeReads,
  type MeSessionAuth,
  type MeWrites,
  type MeWriteTx,
  UsernameTakenError,
} from '@odudu/me';
import {
  adminAuthDeps,
  tenantSmtpRepository,
  verifyTenantAccessToken,
} from '@odudu/protocol-admin';
import { endSessions, tokenGrantRepository } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type Logger as PinoLogger } from 'pino';

export interface MeDepsParts {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly logger: PinoLogger;
  readonly publicBaseUrl: string | undefined;
  // What queuing the mail that proves a changed address needs of the process.
  readonly mail: MeMailParts;
}

export interface MeMailParts {
  readonly resolveMailLook: MailLookResolver;
  readonly mailGate: MailGate;
  // Whether the deployment itself has a relay, for a tenant with none of its own.
  readonly deploymentSmtp: boolean;
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

// The tenant's own name and display name, for the mail that names it.
async function tenantNames(tx: TenantScopedDatabase, tenantId: string) {
  const rows = await tx
    .select({ name: tenants.name, displayName: tenants.displayName })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const row = rows[0];
  if (row === undefined) throw new Error(`tenant ${tenantId} is not visible here`);
  return row;
}

function writeTxFor(
  tx: TenantScopedDatabase,
  tenantId: string,
  kek: Uint8Array,
  mail: MeMailContext,
): MeWriteTx {
  return {
    lockProfile: (subjectId) => userRepository(tx).lockBySubjectId(subjectId),
    updateProfile: (subjectId, patch) => userRepository(tx).updateProfile(subjectId, patch),
    // The only column the update sets that can collide is the username.
    renameUser: async (subjectId, username) => {
      try {
        return await userRepository(tx).updateUsername(subjectId, username);
      } catch (error) {
        if (isUniqueViolation(error)) throw new UsernameTakenError();
        throw error;
      }
    },
    setVerification: (subjectId, patch) => userRepository(tx).setVerification(subjectId, patch),
    lockOwnedSession: (subjectId, sessionId) =>
      sessionRepository(tx).lockOwnedId(subjectId, sessionId),
    liveSessionIds: (subjectId, now, limit, except) =>
      sessionRepository(tx).liveIdsFor(subjectId, now, limit, except ?? undefined),
    endSessions: (input) => endSessions(tx, { kek }, { tenantId, via: 'self', ...input }),
    revokeConsent: async (subjectId, clientKey, now) => {
      const client = await clientRepository(tx).byClientId(clientKey);
      if (client === null) return null;
      const consent = await consentRepository(tx).forSubjectClient(subjectId, client.id);
      if (consent === null) return null;
      if (!(await consentRepository(tx).revoke(subjectId, client.id))) return null;
      const grantsRevoked = await tokenGrantRepository(tx).revokeForSubjectClient(
        subjectId,
        client.id,
        now,
      );
      return { scopeNames: consent.scopeNames, grantsRevoked };
    },
    renameCredential: (subjectId, credentialId, label) =>
      credentialRepository(tx).renameLabel(subjectId, credentialId, label),
    credentialOf: (subjectId, credentialId) =>
      credentialRepository(tx).summaryOf(subjectId, credentialId),
    heldCredentials: (subjectId, limit) =>
      credentialRepository(tx).summariesFor(subjectId, { after: undefined, limit }),
    tenantRequiresSecondFactor: async () =>
      (await tenantSettingsRepository(tx).flowSettings(tenantId)).otpRequired,
    deleteCredential: (credentialId) => credentialRepository(tx).deleteOne(credentialId),
    afterSecondFactorRemoved: async (subjectId) =>
      (await onSecondFactorRemoved(tx, { subjectId }, () => Promise.resolve()))
        .recoveryCodesRevoked,
    mailIsAvailable: async () =>
      mail.publicBaseUrl !== undefined &&
      (mail.deploymentSmtp || (await tenantSmtpRepository(tx).byTenantId(tenantId)) !== null),
    holderOfEmail: (email) => userRepository(tx).holderOfEmail(email),
    mailBudgetAllows: (email) => mail.mailGate('change', tenantId, email),
    setPendingEmail: (subjectId, email) =>
      pendingEmailRepository(tx).set(tenantId, subjectId, email),
    queueAddressProof: async (input) => {
      if (mail.publicBaseUrl === undefined) throw new Error('no public base URL to mail a link to');
      const names = await tenantNames(tx, tenantId);
      await enqueueVerificationLink(
        tx,
        {
          tenantId,
          tenantName: names.name,
          tenantDisplayName: names.displayName ?? names.name,
          issuerBase: mail.publicBaseUrl,
          now: () => new Date(),
          resolveMailLook: mail.resolveMailLook,
        },
        input,
      );
    },
    audit: async (event) => {
      const client = await clientRepository(tx).byClientId(event.actorClientKey);
      await auditRepository(tx).record({
        eventType: 'admin_mutation',
        action: event.action,
        outcome: 'allowed',
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actorSubjectId: event.actorSubjectId,
        actorClientId: client?.id ?? null,
        detail: event.detail,
      });
    },
  };
}

export interface MeMailContext extends MeMailParts {
  readonly publicBaseUrl: string | undefined;
}

// Each change runs in one tenant-scoped transaction: the session cascade, the
// change and its audit row commit together or not at all.
export function meWritesFor(
  database: DatabaseHandle,
  kek: Uint8Array,
  mail: MeMailContext,
): MeWrites {
  return {
    transact: (tenantId, run) =>
      withTenant(database.db, tenantId, (tx) => run(writeTxFor(tx, tenantId, kek, mail))),
  };
}

// The gate's one read: the session a token names, in its own tenant.
export function meSessionAuthFor(database: DatabaseHandle): MeSessionAuth {
  return {
    signedInAt: (tenantId, subjectId, sessionId, lifespans, now) =>
      withTenant(database.db, tenantId, (tx) =>
        sessionRepository(tx).liveCreatedAt(subjectId, sessionId, lifespans, now),
      ),
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
        freshnessSeconds: tenant.sessionFreshnessSeconds,
        usernameEditable: tenant.usernameEditable,
      };
    },
    reads: meReadsFor(parts.database),
    sessionAuth: meSessionAuthFor(parts.database),
    writes: meWritesFor(parts.database, parts.kek, {
      ...parts.mail,
      publicBaseUrl: parts.publicBaseUrl,
    }),
    now: () => new Date(),
    logger: parts.logger,
  };
}
