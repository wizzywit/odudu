import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { type DatabaseHandle, type TenantScopedDatabase, withTenant } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import { hashPassword } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { type Clock, type Logger, systemClock } from '@odudu/kernel';
import { tenantLookupRepository, tokenGrantRepository } from '@odudu/protocol-oidc';
import { type FastifyPluginAsync } from 'fastify';
import { auditRepository } from '#/repository/audit';
import { type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { type Audit as ClientAudit } from '#/usecase/clients';
import { type Audit as FlowAudit } from '#/usecase/flow';
import { type Audit as GroupAudit } from '#/usecase/groups';
import { type Audit as KeyAudit } from '#/usecase/keys';
import { type Audit as RoleAudit } from '#/usecase/roles';
import { type Audit as ScopeAudit } from '#/usecase/scopes';
import { type Audit as ScopeMapperAudit, type MapperCatalogue } from '#/usecase/scope-mappers';
import { type Audit as SettingsAudit } from '#/usecase/settings';
import { type Audit as SmtpAudit } from '#/usecase/smtp';
import { type Audit as SessionAudit } from '#/usecase/sessions';
import { type Audit as SubjectAudit } from '#/usecase/subjects';
import { type Audit } from '#/usecase/tenants';
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
  amendGroupHandler,
  createGroupHandler,
  deleteGroupHandler,
  listGroupsHandler,
  readGroupHandler,
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
  putSmtpHandler,
  readSmtpHandler,
  testSmtpHandler,
  type SmtpRouteDeps,
} from '#/view/routes/smtp';
import {
  createKeyHandler,
  listKeysHandler,
  promoteKeyHandler,
  retireKeyHandler,
  type KeysRouteDeps,
} from '#/view/routes/keys';
import { listAuditHandler, type AuditRouteDeps } from '#/view/routes/audit';
import { registerOpenApiRoute } from '#/view/routes/openapi';
import {
  addRoleCompositeHandler,
  amendRoleHandler,
  createRoleHandler,
  deleteRoleHandler,
  listRolesHandler,
  readRoleHandler,
  type RolesRouteDeps,
} from '#/view/routes/roles';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';
import {
  amendScopeHandler,
  assignScopeToClientHandler,
  createScopeHandler,
  deleteScopeHandler,
  listScopesHandler,
  readScopeHandler,
  setScopeRolesHandler,
  type ScopesRouteDeps,
} from '#/view/routes/scopes';
import {
  deleteSessionHandler,
  listSessionsHandler,
  type SessionsRouteDeps,
} from '#/view/routes/sessions';
import {
  amendSettingsHandler,
  getSettingsHandler,
  type SettingsRouteDeps,
} from '#/view/routes/settings';
import {
  amendSubjectHandler,
  createSubjectHandler,
  deleteCredentialHandler,
  deleteSubjectHandler,
  listCredentialsHandler,
  listSubjectsHandler,
  readSubjectHandler,
  setRequiredActionsHandler,
  setRolesHandler,
  type SubjectsRouteDeps,
} from '#/view/routes/subjects';
import {
  createTenantHandler,
  listTenantsHandler,
  type TenantsRouteDeps,
} from '#/view/routes/tenants';
import { whoamiHandler } from '#/view/routes/whoami';

export { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
export { composeUserSubject, type ComposeUserSubjectInput } from '#/usecase/subjects';
export { tenantSmtpRepository, type TenantSmtpRecord } from '#/repository/tenant-smtp';
export { smtpSenderFromRecord } from '#/usecase/smtp';

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
  // Gates `tls_client_auth` client creation the same way `/token` and
  // dynamic registration gate it (`OidcRoutesDeps.trustProxy`,
  // @odudu/protocol-oidc) — off by default, since a `tls_client_auth`
  // client is unauthenticatable with no proxy in front of this server.
  trustProxy?: boolean;
  // The same `ClaimMapperRegistry` @odudu/protocol-oidc assembles claims
  // from, shared rather than re-instantiated — see `MapperCatalogue`
  // (#/usecase/scope-mappers.ts) for why this package types it that way
  // instead of importing protocol-oidc's own `ClaimContext`.
  claimMappers: MapperCatalogue;
  // Runs immediately after every audit row this plugin records; a
  // rejection propagates into the mutation's own transaction and rolls it
  // back with the row just written. Exists for a test to prove the audit
  // write is transactional — no production caller sets it.
  afterAuditWrite?: () => Promise<void>;
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
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
        readonly resourceId: string;
        readonly actorSubjectId: string;
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
        detail: event.detail,
      });
      // Lets an integration test prove the write above is inside the
      // mutating transaction: its rejection rolls the whole thing back
      // with it. Unset in production.
      if (deps.afterAuditWrite !== undefined) await deps.afterAuditWrite();
    }
    const tenantAudit: Audit = recordAudit;
    const clientAudit: ClientAudit = recordAudit;
    const subjectAudit: SubjectAudit = recordAudit;
    const sessionAudit: SessionAudit = recordAudit;
    const roleAudit: RoleAudit = recordAudit;
    const groupAudit: GroupAudit = recordAudit;
    const scopeAudit: ScopeAudit = recordAudit;
    const keyAudit: KeyAudit = recordAudit;
    const flowAudit: FlowAudit = recordAudit;
    const scopeMapperAudit: ScopeMapperAudit = recordAudit;
    const smtpAudit: SmtpAudit = recordAudit;
    const settingsAudit: SettingsAudit = recordAudit;
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
    };
    const tenantsDeps: TenantsRouteDeps = {
      database: deps.database.db,
      ownerDatabase: deps.ownerDatabase.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: tenantAudit,
    };
    const settingsDeps: SettingsRouteDeps = {
      database: deps.database.db,
      audit: settingsAudit,
    };
    const clientsDeps: ClientsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      hashClientSecret: hashPassword,
      tlsClientAuthEnabled: deps.trustProxy ?? false,
      audit: clientAudit,
    };
    const sessionsDeps: SessionsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: sessionAudit,
      now: () => clock.now(),
      findTenant: (name) => tenantLookupRepository(deps.ownerDatabase.db).byName(name),
    };
    const auditDeps: AuditRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
    };
    const handlers: AdminRouteHandlers = {
      'GET /admin/tenants/:tenant/whoami': whoamiHandler,
      'GET /admin/tenants/:tenant/subjects': listSubjectsHandler(subjectsDeps),
      'POST /admin/tenants/:tenant/subjects': createSubjectHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id': readSubjectHandler(subjectsDeps),
      'PATCH /admin/tenants/:tenant/subjects/:id': amendSubjectHandler(subjectsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id': deleteSubjectHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/credentials': listCredentialsHandler(subjectsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/credentials/:credentialId':
        deleteCredentialHandler(subjectsDeps),
      'PUT /admin/tenants/:tenant/subjects/:id/required-actions':
        setRequiredActionsHandler(subjectsDeps),
      'PUT /admin/tenants/:tenant/subjects/:id/roles': setRolesHandler(subjectsDeps),
      'GET /admin/tenants/:tenant/subjects/:id/sessions': listSessionsHandler(sessionsDeps),
      'DELETE /admin/tenants/:tenant/subjects/:id/sessions/:sid':
        deleteSessionHandler(sessionsDeps),
      'GET /admin/tenants': listTenantsHandler(tenantsDeps),
      'POST /admin/tenants': createTenantHandler(tenantsDeps),
      'GET /admin/tenants/:tenant/settings': getSettingsHandler(settingsDeps),
      'PATCH /admin/tenants/:tenant/settings': amendSettingsHandler(settingsDeps),
      'GET /admin/tenants/:tenant/clients': listClientsHandler(clientsDeps),
      'POST /admin/tenants/:tenant/clients': createClientHandler(clientsDeps),
      'GET /admin/tenants/:tenant/clients/:id': readClientHandler(clientsDeps),
      'PATCH /admin/tenants/:tenant/clients/:id': amendClientHandler(clientsDeps),
      'DELETE /admin/tenants/:tenant/clients/:id': deleteClientHandler(clientsDeps),
      'POST /admin/tenants/:tenant/clients/:id/secret': rotateClientSecretHandler(clientsDeps),
      'GET /admin/tenants/:tenant/roles': listRolesHandler(rolesDeps),
      'POST /admin/tenants/:tenant/roles': createRoleHandler(rolesDeps),
      'GET /admin/tenants/:tenant/roles/:id': readRoleHandler(rolesDeps),
      'PATCH /admin/tenants/:tenant/roles/:id': amendRoleHandler(rolesDeps),
      'DELETE /admin/tenants/:tenant/roles/:id': deleteRoleHandler(rolesDeps),
      'POST /admin/tenants/:tenant/roles/:id/composites': addRoleCompositeHandler(rolesDeps),
      'GET /admin/tenants/:tenant/groups': listGroupsHandler(groupsDeps),
      'POST /admin/tenants/:tenant/groups': createGroupHandler(groupsDeps),
      'GET /admin/tenants/:tenant/groups/:id': readGroupHandler(groupsDeps),
      'PATCH /admin/tenants/:tenant/groups/:id': amendGroupHandler(groupsDeps),
      'DELETE /admin/tenants/:tenant/groups/:id': deleteGroupHandler(groupsDeps),
      'PUT /admin/tenants/:tenant/groups/:id/roles': setGroupRolesHandler(groupsDeps),
      'GET /admin/tenants/:tenant/scopes': listScopesHandler(scopesDeps),
      'POST /admin/tenants/:tenant/scopes': createScopeHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id': readScopeHandler(scopesDeps),
      'PATCH /admin/tenants/:tenant/scopes/:id': amendScopeHandler(scopesDeps),
      'DELETE /admin/tenants/:tenant/scopes/:id': deleteScopeHandler(scopesDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/roles': setScopeRolesHandler(scopesDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/clients/:clientId':
        assignScopeToClientHandler(scopesDeps),
      'GET /admin/tenants/:tenant/scopes/:id/mappers': readScopeMappersHandler(scopeMappersDeps),
      'PUT /admin/tenants/:tenant/scopes/:id/mappers': setScopeMappersHandler(scopeMappersDeps),
      'GET /admin/tenants/:tenant/smtp': readSmtpHandler(smtpDeps),
      'PUT /admin/tenants/:tenant/smtp': putSmtpHandler(smtpDeps),
      'POST /admin/tenants/:tenant/smtp/test': testSmtpHandler(smtpDeps),
      'GET /admin/tenants/:tenant/keys': listKeysHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys': createKeyHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys/:id/promote': promoteKeyHandler(keysDeps),
      'POST /admin/tenants/:tenant/keys/:id/retire': retireKeyHandler(keysDeps),
      'GET /admin/tenants/:tenant/flow/executions': listFlowHandler(flowDeps),
      'PUT /admin/tenants/:tenant/flow/executions': replaceFlowHandler(flowDeps),
      'GET /admin/tenants/:tenant/audit': listAuditHandler(auditDeps),
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
    };

    const authzDeps: AuthorizeAdminDeps = {
      effectiveRoles: (tenantId, subjectId) =>
        withTenant(deps.database.db, tenantId, (tx) => effectiveRoles(tx, subjectId)),
    };

    registerOpenApiRoute(app);
    registerAdminRoutes(app, handlers, authDeps, authzDeps, clock);

    deps.logger.debug({}, 'protocol-admin registered its admin routes');
    return Promise.resolve();
  };
}
