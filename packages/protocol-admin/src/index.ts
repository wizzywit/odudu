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
import { installAdminValidator } from '#/adapter/validation';
import { installProblemDetailsHandler } from '#/view/problem';
import { type AdminRouteHandlers, registerAdminRoutes } from '#/view/routes/router';
import { listSubjectsHandler } from '#/view/routes/subjects';
import { whoamiHandler } from '#/view/routes/whoami';

export { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';

const ADMIN_ROUTE_HANDLERS: AdminRouteHandlers = {
  'GET /admin/tenants/:tenant/whoami': whoamiHandler,
  'GET /admin/tenants/:tenant/subjects': listSubjectsHandler,
};

export interface AdminRoutesDeps {
  database: DatabaseHandle;
  // Owner (RLS-bypassing): see @odudu/protocol-oidc's repository/tenant-lookup.ts.
  ownerDatabase: DatabaseHandle;
  logger: Logger;
  clock?: Clock;
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return (app) => {
    installAdminValidator(app);
    installProblemDetailsHandler(app);

    const clock = deps.clock ?? systemClock;

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

    registerAdminRoutes(app, ADMIN_ROUTE_HANDLERS, authDeps, authzDeps, clock);

    deps.logger.debug({}, 'protocol-admin registered its admin routes');
    return Promise.resolve();
  };
}
