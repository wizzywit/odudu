import { startAuthentication } from '@odudu/authn-flows';
import { signingKeyRepository } from '@odudu/crypto';
import { withRealm, type DatabaseHandle } from '@odudu/db';
import { clientRepository } from '@odudu/domain-realm';
import { type FastifyPluginAsync } from 'fastify';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { realmLookupRepository } from '#/repository/realm-lookup';
import { type ResolvedClient } from '#/usecase/authorization-request';
import { registerAuthorizeRoute } from '#/view/routes/authorize';
import { registerDiscoveryRoute } from '#/view/routes/discovery';
import { registerJwksRoute } from '#/view/routes/jwks';

export interface OidcRoutesDeps {
  database: DatabaseHandle;
  // The owner (RLS-bypassing) connection — see repository/realm-lookup.ts
  // for why resolving {realm} by name needs it and why that is safe.
  ownerDatabase: DatabaseHandle;
}

// The plugin apps/server registers. Discovery never queries the resolved
// realm's own tenant data (constants plus the resolved issuer); JWKS reads
// through signingKeyRepository once realm context is established for the
// resolved realm id.
export function oidcRoutes(deps: OidcRoutesDeps): FastifyPluginAsync {
  return (app) => {
    const findRealm = (name: string) => realmLookupRepository(deps.ownerDatabase.db).byName(name);

    registerDiscoveryRoute(app, { findRealm });
    registerJwksRoute(app, {
      findRealm,
      listPublishableKeys: (realmId) =>
        withRealm(deps.database.db, realmId, (tx) => signingKeyRepository(tx).listPublishable()),
    });
    registerAuthorizeRoute(app, {
      findRealm,
      resolveClient: (realmId, oauthClientId) =>
        withRealm(deps.database.db, realmId, async (tx): Promise<ResolvedClient> => {
          const client = await clientRepository(tx).byClientId(oauthClientId);
          if (client === null) return { client: null, config: null };
          const config = await clientOidcConfigRepository(tx).byClientId(client.id);
          return { client, config };
        }),
      startAuthentication: (realmId, request) =>
        withRealm(deps.database.db, realmId, (tx) => startAuthentication(tx, realmId, request)),
    });

    return Promise.resolve();
  };
}

export { clientOidcConfigRepository } from '#/repository/client-oidc-config';
export { type ClientOidcConfig } from '#/schema/client-oidc-config';
export { realmLookupRepository, type RealmLookup } from '#/repository/realm-lookup';
