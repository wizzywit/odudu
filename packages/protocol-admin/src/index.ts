import { type DatabaseHandle } from '@odudu/db';
import { type Logger } from '@odudu/kernel';
import { type FastifyPluginAsync } from 'fastify';

export interface AdminRoutesDeps {
  database: DatabaseHandle;
  // The owner (RLS-bypassing) connection — see @odudu/protocol-oidc's
  // repository/tenant-lookup.ts for why resolving a tenant by name needs
  // it and why that is safe.
  ownerDatabase: DatabaseHandle;
  logger: Logger;
}

// Registers nothing yet — the plugin apps/server will mount once the admin
// API's routes exist.
export function adminRoutes(deps: AdminRoutesDeps): FastifyPluginAsync {
  return () => {
    deps.logger.debug({}, 'protocol-admin registered no routes yet');
    return Promise.resolve();
  };
}
