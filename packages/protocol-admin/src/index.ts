import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { type DatabaseHandle, withTenant } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import { hashPassword } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { type Clock, type Logger, systemClock } from '@odudu/kernel';
import { tenantLookupRepository, tokenGrantRepository } from '@odudu/protocol-oidc';
import { type FastifyPluginAsync } from 'fastify';
import { type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { type Audit as ClientAudit } from '#/usecase/clients';
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
import { registerOpenApiRoute } from '#/view/routes/openapi';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';
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
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return (app) => {
    installAdminValidator(app);
    installProblemDetailsHandler(app);

    const clock = deps.clock ?? systemClock;

    // Wired for real once an `audit_events` sink exists; until then every
    // mutation still calls `audit`, so nothing here needs rewriting when
    // it does.
    const noopAudit: Audit = () => Promise.resolve();
    const noopClientAudit: ClientAudit = () => Promise.resolve();
    const noopSubjectAudit: SubjectAudit = () => Promise.resolve();
    const subjectsDeps: SubjectsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      audit: noopSubjectAudit,
      now: () => clock.now(),
      // Same call `authzDeps.effectiveRoles` makes below, scoped to
      // whichever tenant the caller's own token was issued from — never the
      // target tenant a cross-tenant system admin is reaching into.
      callerCapabilities: async (issuerTenantId, subjectId) => {
        const roles = await withTenant(deps.database.db, issuerTenantId, (tx) =>
          effectiveRoles(tx, subjectId),
        );
        return new Set(
          roles.filter((role) => role.clientKey === ADMIN_CLIENT_ID).map((role) => role.name),
        );
      },
    };
    const tenantsDeps: TenantsRouteDeps = {
      database: deps.database.db,
      ownerDatabase: deps.ownerDatabase.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: noopAudit,
    };
    const settingsDeps: SettingsRouteDeps = {
      database: deps.database.db,
      audit: () => Promise.resolve(),
    };
    const clientsDeps: ClientsRouteDeps = {
      database: deps.database.db,
      cursorKey: deps.cursorKey,
      hashClientSecret: hashPassword,
      tlsClientAuthEnabled: deps.trustProxy ?? false,
      audit: noopClientAudit,
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
