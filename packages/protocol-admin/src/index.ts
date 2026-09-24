import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { type DatabaseHandle, withTenant } from '@odudu/db';
import { effectiveRoles } from '@odudu/domain-authz';
import { clientRepository } from '@odudu/domain-tenant';
import { type Clock, type Logger, systemClock } from '@odudu/kernel';
import { tenantLookupRepository, tokenGrantRepository } from '@odudu/protocol-oidc';
import { type FastifyPluginAsync } from 'fastify';
import { type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';
import { type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { type Audit } from '#/usecase/tenants';
import { installAdminValidator } from '#/adapter/validation';
import { installProblemDetailsHandler } from '#/view/problem';
import { registerOpenApiRoute } from '#/view/routes/openapi';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';
import { listSubjectsHandler } from '#/view/routes/subjects';
import {
  createTenantHandler,
  listTenantsHandler,
  type TenantsRouteDeps,
} from '#/view/routes/tenants';
import { whoamiHandler } from '#/view/routes/whoami';

export { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

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
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return (app) => {
    installAdminValidator(app);
    installProblemDetailsHandler(app);

    const clock = deps.clock ?? systemClock;

    // Wired for real in Increment 13 (audit_events); until then every
    // mutation still calls `audit`, so nothing here needs rewriting once a
    // real sink exists.
    const noopAudit: Audit = () => Promise.resolve();
    const tenantsDeps: TenantsRouteDeps = {
      database: deps.database.db,
      ownerDatabase: deps.ownerDatabase.db,
      cursorKey: deps.cursorKey,
      kek: deps.kek,
      audit: noopAudit,
    };
    const handlers: AdminRouteHandlers = {
      'GET /admin/tenants/:tenant/whoami': whoamiHandler,
      'GET /admin/tenants/:tenant/subjects': listSubjectsHandler,
      'GET /admin/tenants': listTenantsHandler(tenantsDeps),
      'POST /admin/tenants': createTenantHandler(tenantsDeps),
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
