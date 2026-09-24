import { type DatabaseHandle } from '@odudu/db';
import { type Logger } from '@odudu/kernel';
import { type FastifyPluginAsync } from 'fastify';

export interface AdminRoutesDeps {
  database: DatabaseHandle;
  // Owner (RLS-bypassing): see @odudu/protocol-oidc's repository/tenant-lookup.ts.
  ownerDatabase: DatabaseHandle;
  logger: Logger;
}

export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return () => {
    deps.logger.debug({}, 'protocol-admin registered no routes yet');
    return Promise.resolve();
  };
}
