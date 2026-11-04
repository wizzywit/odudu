import { routeAddress, type TenantAddress } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantAddress: TenantAddress | undefined;
  }
}

// A host that decorated the whole app already did, with the origin of the
// address it resolved; this covers routes registered on an instance of their
// own, whose pages read only the path prefix.
export function ensureTenantAddress(app: FastifyInstance): void {
  if (app.hasRequestDecorator('tenantAddress')) return;
  app.decorateRequest('tenantAddress', undefined);
  app.addHook('onRequest', (request, _reply, done) => {
    request.tenantAddress = routeAddress(request.params, `${request.protocol}://${request.host}`);
    done();
  });
}
