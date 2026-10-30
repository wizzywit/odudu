import { tenantSettingsRepository } from '@odudu/account';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import {
  assetRepository,
  createBrandMemo,
  publishedThemeRepository,
  serveBrand,
  type ServeBrandDeps,
} from '@odudu/domain-theme';
import { servedAssetHeaders, systemClock } from '@odudu/kernel';
import { type FastifyPluginCallback, type FastifyReply, type FastifyRequest } from 'fastify';

const IMMUTABLE = 'public, max-age=31536000, immutable';

// Every brand URL that is not served answers this, whatever made it so.
export function sendBrandMiss(reply: FastifyReply): FastifyReply {
  for (const [name, value] of servedAssetHeaders('cross-origin')) reply.header(name, value);
  return reply.code(404).header('cache-control', 'no-store').send();
}

const BRAND_PATH = /^\/tenants\/[^/?]*\/brand\//u;

// A path segment over the router's length limit is refused before any route
// or hook runs; under the brand prefix that is the same bare 404, elsewhere
// the router's own answer.
export function frameworkError(
  error: { code: string; message: string; statusCode?: number },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (BRAND_PATH.test(request.url)) {
    sendBrandMiss(reply);
    return;
  }
  const statusCode = error.statusCode ?? 400;
  reply.code(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Bad Request',
    code: error.code,
    message: error.message,
    statusCode,
  });
}

// The hashed images and stylesheets a theme names, public by design: every
// URL carries its content hash, so the response never changes and carries no
// cookie, session or tenant-specific header. A file that is missing, another
// tenant's or not published answers the same bare 404. This is not a page
// and bypasses `pageHeaders`. Work per request is a tenant lookup plus one
// indexed read; no bytes are held in process, HTTP caching and a CDN do that.
export function brandRoutes(deps: {
  database: DatabaseHandle;
  ownerDatabase: DatabaseHandle;
  publicBaseUrl: string | undefined;
}): FastifyPluginCallback {
  const serving: ServeBrandDeps = {
    origin: deps.publicBaseUrl === undefined ? undefined : new URL(deps.publicBaseUrl).origin,
    findTenant: (name) => tenantSettingsRepository(deps.ownerDatabase.db).byName(name),
    readAssetMime: (tenantId, sha256) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        assetRepository(tx).publishedMime(tenantId, sha256),
      ),
    readIdentity: (tenantId, clientRowId) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        publishedThemeRepository(tx).identity(tenantId, clientRowId),
      ),
    memo: createBrandMemo(() => systemClock.now().getTime()),
    inflight: new Map(),
    readAsset: (tenantId, sha256) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        assetRepository(tx).getPublished(tenantId, sha256),
      ),
    readPublished: (tenantId, clientRowId) =>
      withTenant(deps.database.db, tenantId, (tx) =>
        publishedThemeRepository(tx).forStylesheet(tenantId, clientRowId),
      ),
  };

  async function answer(
    request: FastifyRequest<{ Params: { tenant: string; client?: string; file: string } }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const { tenant, client, file } = request.params;
    const found = await serveBrand(serving, {
      tenant,
      client: client ?? null,
      file,
      ifNoneMatch: request.headers['if-none-match'],
    });
    if (found === null) return sendBrandMiss(reply);
    for (const [name, value] of servedAssetHeaders('cross-origin')) reply.header(name, value);
    reply.header('etag', found.etag).header('cache-control', IMMUTABLE);
    if (found.kind === 'unchanged') return reply.code(304).send();
    return reply.code(200).header('content-type', found.contentType).send(found.bytes);
  }

  return (fastify, _options, done) => {
    fastify.get('/tenants/:tenant/brand/:file', answer);
    fastify.get('/tenants/:tenant/brand/c/:client/:file', answer);
    done();
  };
}
