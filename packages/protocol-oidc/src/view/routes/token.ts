import { withRealm, type DatabaseHandle } from '@odudu/db';
import { type ClaimMapperRegistry, type Clock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { type ClaimContext } from '#/service/claims';
import { TokenError } from '#/service/errors';
import { issueTokens, type TokenResponse } from '#/usecase/token-issuance';
import { realmIssuerFor } from '#/view/issuer';

export interface TokenRouteDeps {
  database: DatabaseHandle;
  // Shaped like repository/realm-lookup.ts's RealmLookup, not imported from
  // it: view never reaches into repository (dependency-cruiser's
  // no-view-to-repository rule).
  findRealm(name: string): Promise<{ id: string; enabled: boolean } | null>;
  kek: Uint8Array;
  clock: Clock;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Shared with /userinfo: the ID token's claims and a /userinfo response
  // for the same subject and scope come from the same registry, so one can
  // never carry a claim the other omits.
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  loadClaimContext(realmId: string, subjectId: string): Promise<ClaimContext>;
}

export function registerTokenRoute(app: FastifyInstance, deps: TokenRouteDeps): void {
  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/protocol/openid-connect/token', async (request, reply) => {
    const realm = await deps.findRealm(request.params.realm);
    if (!realm?.enabled) return reply.code(404).send();

    const issuer = realmIssuerFor(request, request.params.realm);

    try {
      const response: TokenResponse = await withRealm(deps.database.db, realm.id, (tx) =>
        issueTokens(
          tx,
          {
            database: deps.database,
            realmId: realm.id,
            issuer,
            kek: deps.kek,
            clock: deps.clock,
            verifyPassword: deps.verifyPassword,
            claimMappers: deps.claimMappers,
            loadClaimContext: (realmId, subjectId) => deps.loadClaimContext(realmId, subjectId),
          },
          request.body,
          request.headers.authorization,
        ),
      );

      return await reply
        .code(200)
        .header('cache-control', 'no-store')
        .header('pragma', 'no-cache')
        .send(response);
    } catch (err) {
      if (err instanceof TokenError) {
        if (err.wwwAuthenticate !== undefined) {
          reply.header('www-authenticate', err.wwwAuthenticate);
        }
        return reply
          .code(err.status)
          .header('cache-control', 'no-store')
          .header('pragma', 'no-cache')
          .send({ error: err.error });
      }
      throw err;
    }
  });
}
