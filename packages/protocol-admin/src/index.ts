import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { type DatabaseHandle, type TenantScopedDatabase, withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { effectiveRoles } from '@odudu/domain-authz';
import { hashPassword, subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { type ClaimMapperRegistry, type Clock, type Logger, systemClock } from '@odudu/kernel';
import {
  tenantLookupRepository,
  tokenGrantRepository,
  type ClaimContext,
} from '@odudu/protocol-oidc';
import { type FastifyPluginAsync } from 'fastify';
import { type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { type Audit as ClientAudit } from '#/usecase/clients';
import { type Audit as FlowAudit } from '#/usecase/flow';
import { type Audit as GroupAudit } from '#/usecase/groups';
import { type Audit as KeyAudit } from '#/usecase/keys';
import { type Audit as RegistrationTokenAudit } from '#/usecase/registration-tokens';
import { type Audit as RoleAudit } from '#/usecase/roles';
import { type Audit as ScopeAudit } from '#/usecase/scopes';
import { type Audit as ScopeMapperAudit } from '#/usecase/scope-mappers';
import { type Audit as SettingsAudit } from '#/usecase/settings';
import { type Audit as TenantExportAudit } from '#/usecase/tenant-export';
import { type Audit as TenantImportAudit } from '#/usecase/tenant-import';
import { type Audit as SmtpAudit } from '#/usecase/smtp';
import { type Audit as AccountRecoveryAudit } from '#/usecase/account-recovery';
import { type Audit as ConsentAudit } from '#/usecase/consents';
import { type Audit as SessionAudit } from '#/usecase/sessions';
import { type Audit as GrantAudit } from '#/usecase/grants';
import { type EndTenantSessionsDeps } from '#/usecase/tenant-sessions';
import { type Audit as SubjectAudit } from '#/usecase/subjects';
import { type Audit } from '#/usecase/tenants';
import { resolveHostAddresses } from '#/adapter/host-addresses';
import { installAdminValidator } from '#/adapter/validation';
import { installProblemDetailsHandler } from '#/view/problem';
import {
  amendClientHandler,
  createClientHandler,
  deleteClientHandler,
  listClientsHandler,
  readClientHandler,
  rotateClientSecretHandler,
  type ClientsRouteDeps,
} from '#/view/routes/clients';
import {
  clearLockoutHandler,
  issuePasswordHandler,
  readLockoutHandler,
  revokeRecoveryCodesHandler,
  type AccountRecoveryRouteDeps,
} from '#/view/routes/account-recovery';
import {
  deleteConsentHandler,
  listConsentsHandler,
  type ConsentsRouteDeps,
} from '#/view/routes/consents';
import {
  amendGroupHandler,
  createGroupHandler,
  deleteGroupHandler,
  listGroupsHandler,
  readGroupHandler,
  readGroupRolesHandler,
  setGroupRolesHandler,
  type GroupsRouteDeps,
} from '#/view/routes/groups';
import { listFlowHandler, replaceFlowHandler, type FlowRouteDeps } from '#/view/routes/flow';
import {
  readScopeMappersHandler,
  setScopeMappersHandler,
  type ScopeMappersRouteDeps,
} from '#/view/routes/scope-mappers';
import {
  deleteSmtpHandler,
  putSmtpHandler,
  readSmtpHandler,
  testSmtpHandler,
  type SmtpRouteDeps,
} from '#/view/routes/smtp';
import {
  createKeyHandler,
  deleteKeyHandler,
  listKeysHandler,
  promoteKeyHandler,
  retireKeyHandler,
  type KeysRouteDeps,
} from '#/view/routes/keys';
import {
  countAuditHandler,
  exportAuditHandler,
  listAuditHandler,
  type AuditRouteDeps,
} from '#/view/routes/audit';
import {
  countClientsHandler,
  countGroupsHandler,
  countRolesHandler,
  countScopesHandler,
  countSubjectsHandler,
  countTenantsHandler,
  type CountsRouteDeps,
} from '#/view/routes/counts';
import { registerOpenApiRoute } from '#/view/routes/openapi';
import {
  listRegistrationTokensHandler,
  mintRegistrationTokenHandler,
  revokeRegistrationTokenHandler,
  type RegistrationTokensRouteDeps,
} from '#/view/routes/registration-tokens';
import {
  addRoleCompositeHandler,
  amendRoleHandler,
  createRoleHandler,
  deleteRoleHandler,
  listRoleCompositesHandler,
  listRolesHandler,
  readRoleHandler,
  removeRoleCompositeHandler,
  setRoleDefaultHandler,
  type RolesRouteDeps,
} from '#/view/routes/roles';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';
import {
  amendScopeHandler,
  assignScopeToClientHandler,
  createScopeHandler,
  deleteScopeHandler,
  listScopeClientsHandler,
  listScopesHandler,
  readScopeHandler,
  readScopeRolesHandler,
  setScopeRolesHandler,
  unassignScopeFromClientHandler,
  type ScopesRouteDeps,
} from '#/view/routes/scopes';
import {
  deleteAllSessionsHandler,
  deleteSessionHandler,
  listSessionsHandler,
  type SessionsRouteDeps,
} from '#/view/routes/sessions';
import {
  amendSettingsHandler,
  getSettingsHandler,
  type SettingsRouteDeps,
} from '#/view/routes/settings';
import { exportTenantHandler, type TenantExportRouteDeps } from '#/view/routes/tenant-export';
import { importTenantHandler, type TenantImportRouteDeps } from '#/view/routes/tenant-import';
import {
  amendProfileHandler,
  amendSubjectHandler,
  createSubjectHandler,
  deleteCredentialHandler,
  deleteSubjectHandler,
  listCredentialsHandler,
  listEffectiveRolesHandler,
  listSubjectsHandler,
  readProfileHandler,
  readRequiredActionsHandler,
  readSubjectHandler,
  readUsernamePolicyHandler,
  readSubjectGroupsHandler,
  readSubjectRolesHandler,
  setRequiredActionsHandler,
  setRolesHandler,
  setSubjectGroupsHandler,
  type SubjectsRouteDeps,
} from '#/view/routes/subjects';
import {
  amendTenantHandler,
  createTenantHandler,
  deleteTenantHandler,
  listTenantsHandler,
  readTenantHandler,
  type TenantsRouteDeps,
} from '#/view/routes/tenants';
import { whoamiHandler } from '#/view/routes/whoami';
import {
  evaluateClaimsHandler,
  listLogoutDeliveriesHandler,
  listMailHandler,
  readInstallationHandler,
  type OperationsRouteDeps,
} from '#/view/routes/operations';
import {
  sendPasswordResetHandler,
  sendVerificationHandler,
  type AccountEmailRouteDeps,
} from '#/view/routes/account-email';
import { type SendAccountLink } from '#/usecase/account-email';
import {
  bulkSubjectsHandler,
  clearLockoutsHandler,
  type BulkSubjectsRouteDeps,
} from '#/view/routes/bulk-subjects';
import {
  listSubjectGrantsHandler,
  revokeClientGrantsHandler,
  revokeSubjectGrantsHandler,
  type GrantsRouteDeps,
} from '#/view/routes/grants';
import {
  countTenantSessionsHandler,
  endTenantSessionsHandler,
  listClientSessionsHandler,
  listTenantSessionsHandler,
  type TenantSessionsRouteDeps,
} from '#/view/routes/tenant-sessions';

export { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
export { expireRotatedClientSecrets } from '#/usecase/client-secret-expiry';
export { composeUserSubject, type ComposeUserSubjectInput } from '#/usecase/subjects';
export { tenantSmtpRepository, type TenantSmtpRecord } from '#/repository/tenant-smtp';
export { resolveHostAddresses } from '#/adapter/host-addresses';
export { smtpSenderFromRecord, type SenderFromRecordOutcome } from '#/usecase/smtp';
export {
  checkSmtpDestination,
  type ResolveHost,
  type SmtpDestinationOutcome,
  type SmtpDestinationPolicy,
} from '#/service/smtp-destination';

export interface AdminRoutesDeps {
  database: DatabaseHandle;
  // Owner (RLS-bypassing): see @odudu/protocol-oidc's repository/tenant-lookup.ts.
  ownerDatabase: DatabaseHandle;
  logger: Logger;
  clock?: Clock;
  // Tags a cursor to the collection and tenant it was minted for
  // (packages/protocol-admin/src/service/cursor.ts). Reusing the app's own
  // KEK is safe: encodeCursor/decodeCursor derive their HMAC key from it
  // with their own domain separator, never the raw bytes.
  cursorKey: Uint8Array;
  // Encrypts a signing key minted for a tenant created through this API
  // (createTenant, #/usecase/tenants.ts) — the same KEK `seedAdmin` and
  // `seed tenant` use.
  kek: Uint8Array;
  // `ODUDU_PUBLIC_BASE_URL` while the console is on: a tenant created or
  // imported here has the console's redirect and post-logout URIs
  // registered on its admin client under this base. Unset, it has neither.
  consoleBaseUrl?: string | undefined;
  // Gates `tls_client_auth` client creation the same way `/token` and
  // dynamic registration gate it (`OidcRoutesDeps.trustProxy`,
  // @odudu/protocol-oidc) — off by default, since a `tls_client_auth`
  // client is unauthenticatable with no proxy in front of this server.
  trustProxy?: boolean;
  // The same `ClaimMapperRegistry` @odudu/protocol-oidc assembles claims
  // from, shared rather than re-instantiated, so a mapper bound here and a
  // claim evaluated here are the ones issuance runs.
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  // Whether a tenant may point its own SMTP host at a private address —
  // ADR 0028's escape hatch, applied to the relay a tenant configures for
  // itself. Off by default; loopback stays refused either way.
  allowPrivateSmtpHosts?: boolean;
  // Whether `ODUDU_SMTP_HOST` and `ODUDU_SMTP_FROM` give the deployment a
  // sender of its own, which a tenant with no relay falls back to — what
  // `GET /smtp` reports as `effective`. Off by default.
  deploymentSmtp?: boolean;
  // Spends a subject's outstanding reset-password links when an
  // administrator issues it a one-time password. The links belong to
  // @odudu/account, which the composition root wires this to.
  retireResetLinks: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
  // Mints a reset-password or verification link and queues its mail, the
  // write @odudu/account's self-service doors make; wired at the composition
  // root with the public base URL a link is addressed under.
  sendAccountLink: SendAccountLink;
  // `ODUDU_OUTBOX_MAX_ATTEMPTS`, the attempts the mail sender makes before it
  // stops offering a message: what `GET …/mail` reports as `failed`.
  outboxMaxAttempts: number;
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return buildAdminRoutes(deps, undefined);
}

/**
 * Identical to `adminRoutes`, plus a hook run immediately after every audit
 * row this plugin records; a rejection propagates into the mutation's own
 * transaction and rolls it back with the row just written. Not part of
 * `AdminRoutesDeps` — no production caller of `adminRoutes` can reach it —
 * because its only use is a test proving that write is transactional.
 */
export function adminRoutesForTesting(
  deps: AdminRoutesDeps,
  afterAuditWrite: () => Promise<void>,
): FastifyPluginAsync {
  return buildAdminRoutes(deps, afterAuditWrite);
}

function buildAdminRoutes(
  deps: AdminRoutesDeps,
  afterAuditWrite: (() => Promise<void>) | undefined,
): FastifyPluginAsync {
  return (app) => {
    installAdminValidator(app);
    installProblemDetailsHandler(app);

    const clock = deps.clock ?? systemClock;

    // Every usecase group's `XAuditEvent` has this same shape, so one
    // function writes all of them through `auditRepository` — in the same
    // transaction the usecase is already inside, since `tx` is the one it
    // calls this with. Parameter contravariance is what lets one function
    // typed on the common shape stand in for each group's own narrower
    // `Audit` type below.
    async function recordAudit(
      tx: TenantScopedDatabase,
      event: {
        readonly action: string;
        readonly resourceType: string;
        readonly resourceId: string | null;
        readonly actorSubjectId: string;
        readonly actorTenantId: string;
        readonly actorClientId: string;
        readonly outcome: 'allowed' | 'refused' | 'failed';
        readonly detail?: Record<string, unknown>;
      },
    ): Promise<void> {
      await auditRepository(tx).record({
        eventType: 'admin_mutation',
        action: event.action,
        outcome: event.outcome,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actorSubjectId: event.actorSubjectId,
        actorTenantId: event.actorTenantId,
        actorClientId: event.actorClientId,
        detail: event.detail,
      });
      // Lets an integration test prove the write above is inside the
      // mutating transaction: its rejection rolls the whole thing back
      // with it. Unset in production.
      if (afterAuditWrite !== undefined) await afterAuditWrite();
    }
    const tenantAudit: Audit = recordAudit;
    const clientAudit: ClientAudit = recordAudit;
    const registrationTokenAudit: RegistrationTokenAudit = recordAudit;
    const subjectAudit: SubjectAudit = recordAudit;
    const sessionAudit: SessionAudit = recordAudit;
    const grantAudit: GrantAudit = recordAudit;
    const tenantSessionsAudit: EndTenantSessionsDeps['audit'] = recordAudit;
    const consentAudit: ConsentAudit = recordAudit;
    const accountRecoveryAudit: AccountRecoveryAudit = recordAudit;
    const roleAudit: RoleAudit = recordAudit;
    const groupAudit: GroupAudit = recordAudit;
    const scopeAudit: ScopeAudit = recordAudit;
    const keyAudit: KeyAudit = recordAudit;
    const flowAudit: FlowAudit = recordAudit;
    const scopeMapperAudit: ScopeMapperAudit = recordAudit;
    const smtpAudit: SmtpAudit = recordAudit;
    const settingsAudit: SettingsAudit = recordAudit;
    const tenantExportAudit: TenantExportAudit = recordAudit;
    const tenantImportAudit: TenantImportAudit = recordAudit;
    // Same call `authzDeps.effectiveRoles` makes below, scoped to whichever
    // tenant the caller's own token was issued from — never the target
    // tenant a cross-tenant system admin is reaching into. Shared by
    // subjects' setRoles and roles' addRoleComposite: the same capability
    // ceiling, computed the same way.
    const callerCapabilities = async (
      issuerTenantId: string,
      subjectId: string,
    ): Promise<ReadonlySet<string>> => {
      const roles = await withTenant(deps.database.db, issuerTenantId, (tx) =>
        effectiveRoles(tx, subjectId),
      );
      return new Set(
        roles.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name),
      );
    };
    const subjectsDeps: SubjectsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: subjectAudit,
      now: () => clock.now(),
      callerCapabilities,
    };
    const rolesDeps: RolesRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: roleAudit,
      callerCapabilities,
    };
    const groupsDeps: GroupsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: groupAudit,
      callerCapabilities,
    };
    const scopesDeps: ScopesRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: scopeAudit,
      callerCapabilities,
    };
    const keysDeps: KeysRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: keyAudit,
    };
    const flowDeps: FlowRouteDeps = {
      database: deps.database.db,
      audit: flowAudit,
    };
    const scopeMappersDeps: ScopeMappersRouteDeps = {
      database: deps.database.db,
      claimMappers: deps.claimMappers,
      audit: scopeMapperAudit,
    };
    const smtpDeps: SmtpRouteDeps = {
      database: deps.database.db,
      kek: deps.kek,
      audit: smtpAudit,
      smtpDestination: {
        allowPrivate: deps.allowPrivateSmtpHosts ?? false,
        resolve: resolveHostAddresses,
      },
      deploymentSmtp: deps.deploymentSmtp ?? false,
    };
    const tenantsDeps: TenantsRouteDeps = {
      database: deps.database.db,
      ownerDatabase: deps.ownerDatabase.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: tenantAudit,
      consoleBaseUrl: deps.consoleBaseUrl,
      callerCapabilities,
      now: () => clock.now(),
      sessionsAudit: tenantSessionsAudit,
    };
    const tenantExportDeps: TenantExportRouteDeps = {
      database: deps.database.db,
      audit: tenantExportAudit,
      callerCapabilities,
    };
    const tenantImportDeps: TenantImportRouteDeps = {
      database: deps.database.db,
      kek: deps.kek,
      audit: tenantImportAudit,
      consoleBaseUrl: deps.consoleBaseUrl,
      hashClientSecret: hashPassword,
      tlsClientAuthEnabled: deps.trustProxy ?? false,
      claimMappers: deps.claimMappers,
      tenantNameTaken: async (name) =>
        (await tenantLookupRepository(deps.ownerDatabase.db).byName(name)) !== null,
      callerCapabilities,
    };
    const settingsDeps: SettingsRouteDeps = {
      database: deps.database.db,
      audit: settingsAudit,
      kek: deps.kek,
      now: () => clock.now(),
      sessionsAudit: tenantSessionsAudit,
    };
    const clientsDeps: ClientsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      hashClientSecret: hashPassword,
      tlsClientAuthEnabled: deps.trustProxy ?? false,
      audit: clientAudit,
      now: () => clock.now(),
      callerCapabilities,
    };
    const registrationTokensDeps: RegistrationTokensRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: registrationTokenAudit,
    };
    const sessionsDeps: SessionsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: sessionAudit,
      callerCapabilities,
      now: () => clock.now(),
      findTenant: (name) => tenantLookupRepository(deps.ownerDatabase.db).byName(name),
    };
    const bulkSubjectsDeps: BulkSubjectsRouteDeps = {
      database: deps.database.db,
      subjectAudit,
      sessionAudit,
      lockoutsAudit: recordAudit,
      kek: deps.kek,
      callerCapabilities,
      now: () => clock.now(),
      findTenant: (name) => tenantLookupRepository(deps.ownerDatabase.db).byName(name),
    };
    const accountEmailDeps: AccountEmailRouteDeps = {
      database: deps.database.db,
      audit: recordAudit,
      sendLink: deps.sendAccountLink,
      deploymentSmtp: deps.deploymentSmtp ?? false,
      callerCapabilities,
    };
    const operationsDeps: OperationsRouteDeps = {
      database: deps.database.db,
      claimMappers: deps.claimMappers,
      audit: recordAudit,
      cursorKey: deps.cursorKey,
      outboxMaxAttempts: deps.outboxMaxAttempts,
      callerCapabilities,
    };
    const tenantSessionsDeps: TenantSessionsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: tenantSessionsAudit,
      callerCapabilities,
      now: () => clock.now(),
      findTenant: (name) => tenantLookupRepository(deps.ownerDatabase.db).byName(name),
    };
    const grantsDeps: GrantsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: grantAudit,
      callerCapabilities,
      now: () => clock.now(),
    };
    const consentsDeps: ConsentsRouteDeps = {
      database: deps.database.db,
      audit: consentAudit,
      callerCapabilities,
      now: () => clock.now(),
    };
    const accountRecoveryDeps: AccountRecoveryRouteDeps = {
      database: deps.database.db,
      audit: accountRecoveryAudit,
      callerCapabilities,
      retireResetLinks: deps.retireResetLinks,
      now: () => clock.now(),
    };
    const auditDeps: AuditRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: recordAudit,
      callerCapabilities,
    };
    const countsDeps: CountsRouteDeps = {
      database: deps.database.db,
      ownerDatabase: deps.ownerDatabase.db,
      now: () => clock.now(),
    };
    const handlers: AdminRouteHandlers = {
      'GET /admin/tenants/:tenant/whoami': whoamiHandler({ callerCapabilities }),
      'GET /admin/tenants/:tenant/subjects': listSubjectsHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/count': countSubjectsHandler(countsDeps),
      'GET /admin/tenants/:tenant/subjects/username-policy':
        readUsernamePolicyHandler(subjectsDeps),
      'POST /admin/tenants/:tenant/subjects': createSubjectHandler(subjectsDeps),
      'POST /admin/tenants/:tenant/subjects/bulk': bulkSubjectsHandler(bulkSubjectsDeps),
      'DELETE /admin/tenants/:tenant/lockouts': clearLockoutsHandler(bulkSubjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id': readSubjectHandler(subjectsDeps),
      'PATCH /admin/tenants/:tenant/subjects/:id': amendSubjectHandler(subjectsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id': deleteSubjectHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/profile': readProfileHandler(subjectsDeps),
      'PATCH /admin/tenants/:tenant/subjects/:id/profile': amendProfileHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/credentials': listCredentialsHandler(subjectsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/credentials/:credentialId':
        deleteCredentialHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/consents': listConsentsHandler(consentsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/consents/:clientId':
        deleteConsentHandler(consentsDeps),
      'POST /admin/tenants/:tenant/subjects/:id/password':
        issuePasswordHandler(accountRecoveryDeps),
      'POST /admin/tenants/:tenant/subjects/:id/password-reset':
        sendPasswordResetHandler(accountEmailDeps),
      'POST /admin/tenants/:tenant/subjects/:id/verification':
        sendVerificationHandler(accountEmailDeps),
      'GET /admin/tenants/:tenant/subjects/:id/lockout': readLockoutHandler(accountRecoveryDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/lockout':
        clearLockoutHandler(accountRecoveryDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/recovery-codes':
        revokeRecoveryCodesHandler(accountRecoveryDeps),
      'GET /admin/tenants/:tenant/subjects/:id/required-actions':
        readRequiredActionsHandler(subjectsDeps),
      'PUT /admin/tenants/:tenant/subjects/:id/required-actions':
        setRequiredActionsHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/roles': readSubjectRolesHandler(subjectsDeps),
      'PUT /admin/tenants/:tenant/subjects/:id/roles': setRolesHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/effective-roles':
        listEffectiveRolesHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/groups': readSubjectGroupsHandler(subjectsDeps),
      'PUT /admin/tenants/:tenant/subjects/:id/groups': setSubjectGroupsHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/sessions': listSessionsHandler(sessionsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/sessions': deleteAllSessionsHandler(sessionsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/sessions/:sid':
        deleteSessionHandler(sessionsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/grants': listSubjectGrantsHandler(grantsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/grants/:clientId':
        revokeSubjectGrantsHandler(grantsDeps),
      'GET /admin/tenants/:tenant/sessions': listTenantSessionsHandler(tenantSessionsDeps),
      'GET /admin/tenants/:tenant/sessions/count': countTenantSessionsHandler(tenantSessionsDeps),
      'DELETE /admin/tenants/:tenant/sessions': endTenantSessionsHandler(tenantSessionsDeps),
      'GET /admin/tenants/:tenant/clients/:id/sessions':
        listClientSessionsHandler(tenantSessionsDeps),
      'DELETE /admin/tenants/:tenant/clients/:id/grants': revokeClientGrantsHandler(grantsDeps),
      'GET /admin/tenants': listTenantsHandler(tenantsDeps),
      'GET /admin/tenants/count': countTenantsHandler(countsDeps),
      'POST /admin/tenants': createTenantHandler(tenantsDeps),
      'POST /admin/tenant-imports': importTenantHandler(tenantImportDeps),
      'GET /admin/tenants/:tenant': readTenantHandler(tenantsDeps),
      'PATCH /admin/tenants/:tenant': amendTenantHandler(tenantsDeps),
      'DELETE /admin/tenants/:tenant': deleteTenantHandler(tenantsDeps),
      'GET /admin/tenants/:tenant/export': exportTenantHandler(tenantExportDeps),
      'GET /admin/tenants/:tenant/settings': getSettingsHandler(settingsDeps),
      'PATCH /admin/tenants/:tenant/settings': amendSettingsHandler(settingsDeps),
      'GET /admin/tenants/:tenant/clients': listClientsHandler(clientsDeps),
      'GET /admin/tenants/:tenant/clients/count': countClientsHandler(countsDeps),
      'POST /admin/tenants/:tenant/clients': createClientHandler(clientsDeps),
      'GET /admin/tenants/:tenant/clients/:id': readClientHandler(clientsDeps),
      'PATCH /admin/tenants/:tenant/clients/:id': amendClientHandler(clientsDeps),
      'DELETE /admin/tenants/:tenant/clients/:id': deleteClientHandler(clientsDeps),
      'POST /admin/tenants/:tenant/clients/:id/secret': rotateClientSecretHandler(clientsDeps),
      'GET /admin/tenants/:tenant/registration-tokens':
        listRegistrationTokensHandler(registrationTokensDeps),
      'POST /admin/tenants/:tenant/registration-tokens':
        mintRegistrationTokenHandler(registrationTokensDeps),
      'DELETE /admin/tenants/:tenant/registration-tokens/:id':
        revokeRegistrationTokenHandler(registrationTokensDeps),
      'GET /admin/tenants/:tenant/roles': listRolesHandler(rolesDeps),
      'GET /admin/tenants/:tenant/roles/count': countRolesHandler(countsDeps),
      'POST /admin/tenants/:tenant/roles': createRoleHandler(rolesDeps),
      'GET /admin/tenants/:tenant/roles/:id': readRoleHandler(rolesDeps),
      'PATCH /admin/tenants/:tenant/roles/:id': amendRoleHandler(rolesDeps),
      'DELETE /admin/tenants/:tenant/roles/:id': deleteRoleHandler(rolesDeps),
      'POST /admin/tenants/:tenant/roles/:id/composites': addRoleCompositeHandler(rolesDeps),
      'GET /admin/tenants/:tenant/roles/:id/composites': listRoleCompositesHandler(rolesDeps),
      'DELETE /admin/tenants/:tenant/roles/:id/composites/:childId':
        removeRoleCompositeHandler(rolesDeps),
      'PUT /admin/tenants/:tenant/roles/:id/default': setRoleDefaultHandler(rolesDeps),
      'GET /admin/tenants/:tenant/groups': listGroupsHandler(groupsDeps),
      'GET /admin/tenants/:tenant/groups/count': countGroupsHandler(countsDeps),
      'POST /admin/tenants/:tenant/groups': createGroupHandler(groupsDeps),
      'GET /admin/tenants/:tenant/groups/:id': readGroupHandler(groupsDeps),
      'PATCH /admin/tenants/:tenant/groups/:id': amendGroupHandler(groupsDeps),
      'DELETE /admin/tenants/:tenant/groups/:id': deleteGroupHandler(groupsDeps),
      'GET /admin/tenants/:tenant/groups/:id/roles': readGroupRolesHandler(groupsDeps),
      'PUT /admin/tenants/:tenant/groups/:id/roles': setGroupRolesHandler(groupsDeps),
      'GET /admin/tenants/:tenant/scopes': listScopesHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/count': countScopesHandler(countsDeps),
      'POST /admin/tenants/:tenant/scopes': createScopeHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id': readScopeHandler(scopesDeps),
      'PATCH /admin/tenants/:tenant/scopes/:id': amendScopeHandler(scopesDeps),
      'DELETE /admin/tenants/:tenant/scopes/:id': deleteScopeHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id/roles': readScopeRolesHandler(scopesDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/roles': setScopeRolesHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id/clients': listScopeClientsHandler(scopesDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/clients/:clientId':
        assignScopeToClientHandler(scopesDeps),
      'DELETE /admin/tenants/:tenant/scopes/:id/clients/:clientId':
        unassignScopeFromClientHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id/mappers': readScopeMappersHandler(scopeMappersDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/mappers': setScopeMappersHandler(scopeMappersDeps),
      'GET /admin/tenants/:tenant/smtp': readSmtpHandler(smtpDeps),
      'PUT /admin/tenants/:tenant/smtp': putSmtpHandler(smtpDeps),
      'DELETE /admin/tenants/:tenant/smtp': deleteSmtpHandler(smtpDeps),
      'POST /admin/tenants/:tenant/smtp/test': testSmtpHandler(smtpDeps),
      'GET /admin/tenants/:tenant/keys': listKeysHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys': createKeyHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys/:id/promote': promoteKeyHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys/:id/retire': retireKeyHandler(keysDeps),
      'DELETE /admin/tenants/:tenant/keys/:id': deleteKeyHandler(keysDeps),
      'GET /admin/tenants/:tenant/mail': listMailHandler(operationsDeps),
      'GET /admin/tenants/:tenant/clients/:id/logout-deliveries':
        listLogoutDeliveriesHandler(operationsDeps),
      'GET /admin/tenants/:tenant/clients/:id/installation':
        readInstallationHandler(operationsDeps),
      'GET /admin/tenants/:tenant/clients/:id/evaluate': evaluateClaimsHandler(operationsDeps),
      'GET /admin/tenants/:tenant/flow/executions': listFlowHandler(flowDeps),
      'PUT /admin/tenants/:tenant/flow/executions': replaceFlowHandler(flowDeps),
      'GET /admin/tenants/:tenant/audit': listAuditHandler(auditDeps),
      'GET /admin/tenants/:tenant/audit/count': countAuditHandler(auditDeps),
      'GET /admin/tenants/:tenant/audit/export': exportAuditHandler(auditDeps),
    };

    const authDeps: AuthenticateAdminDeps = {
      findTenant: (name) => tenantLookupRepository(deps.ownerDatabase.db).byName(name),
      listPublishableKeys: (tenantId) =>
        withTenant(deps.database.db, tenantId, (tx) => signingKeyRepository(tx).listPublishable()),
      loadGrant: (tenantId, grantId) =>
        withTenant(deps.database.db, tenantId, (tx) => tokenGrantRepository(tx).byId(grantId)),
      isSessionLive: (tenantId, sessionId, lifespans, now) =>
        withTenant(deps.database.db, tenantId, async (tx) => {
          const session = await sessionRepository(tx).liveById(sessionId, lifespans, now);
          return session !== null;
        }),
      isClientEnabled: (tenantId, clientDbId) =>
        withTenant(deps.database.db, tenantId, async (tx) => {
          const client = await clientRepository(tx).byId(clientDbId);
          return client?.enabled === true;
        }),
      isSubjectEnabled: (tenantId, subjectId) =>
        withTenant(deps.database.db, tenantId, async (tx) =>
          subjectIsEnabled(await subjectRepository(tx).byId(subjectId)),
        ),
    };

    const authzDeps: AuthorizeAdminDeps = {
      effectiveRoles: (tenantId, subjectId) =>
        withTenant(deps.database.db, tenantId, (tx) => effectiveRoles(tx, subjectId)),
    };

    registerOpenApiRoute(app);
    registerAdminRoutes(app, handlers, {
      auth: authDeps,
      authz: authzDeps,
      clock,
      database: deps.database.db,
    });

    deps.logger.debug({}, 'protocol-admin registered its admin routes');
    return Promise.resolve();
  };
}
