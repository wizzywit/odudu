import { type FastifyPluginAsync, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  etagMatches,
  OduduError,
  readStaticTree,
  staticEtag,
  type StaticFile,
} from '@odudu/kernel';

const TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// A stylesheet, a mark, the icons and twelve fonts under one directory; the bounds
// refuse a directory that is not the build.
const LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxFiles: 100,
  maxEntries: 128,
  maxTotalBytes: 8 * 1024 * 1024,
} as const;

// `buildInstrument` names a font `<name>.<8 hex of its content>.woff2`.
const CONTENT_HASHED_FONT = /^fonts\/[a-z0-9-]+\.[0-9a-f]{8}\.woff2$/u;

function unavailable(dir: string, err: unknown): string {
  const why =
    err instanceof OduduError && err.code === 'static_tree_too_large'
      ? `${err.message}, which is not the build`
      : `no built stylesheet: ${err instanceof Error ? err.message : 'unknown error'}`;
  return `ODUDU_INSTRUMENT_DIR (${dir}) cannot be served, ${why}; /instrument/* answers 404`;
}

// The stylesheet's name is fixed (the pages link it), so it revalidates
// by etag; a font's name carries its content, so it never does. A font is
// public and fetched without credentials, and any origin may read it: the
// theme preview is framed without an origin of its own, and a font is
// fetched with CORS.
// `/favicon.ico` is the one request a browser makes without being told,
// so it answers with the same icon the pages link.
export function instrumentRoutes(dir: string): FastifyPluginAsync {
  return async (fastify) => {
    let tree: ReadonlyMap<string, StaticFile>;
    try {
      tree = await readStaticTree(dir, TYPES, LIMITS, (message) => {
        fastify.log.warn(`ODUDU_INSTRUMENT_DIR: ${message}`);
      });
    } catch (err) {
      fastify.log.warn(unavailable(dir, err));
      return;
    }
    const etags = new Map([...tree].map(([path, file]) => [path, staticEtag(file.content)]));

    const serve = (path: string, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
      const file = tree.get(path);
      const etag = etags.get(path);
      if (file === undefined || etag === undefined) {
        return reply.code(404).header('x-content-type-options', 'nosniff').send();
      }
      const immutable = CONTENT_HASHED_FONT.test(path);
      if (path.endsWith('.woff2')) reply.header('access-control-allow-origin', '*');
      reply
        .header('etag', etag)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (etagMatches(request.headers['if-none-match'], etag)) return reply.code(304).send();
      return reply.code(200).header('content-type', file.contentType).send(file.content);
    };

    fastify.get<{ Params: { '*': string } }>('/instrument/*', (request, reply) =>
      serve(request.params['*'], request, reply),
    );
    fastify.get('/favicon.ico', (request, reply) => serve('favicon.ico', request, reply));
  };
}
