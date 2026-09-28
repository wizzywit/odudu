import { type FastifyInstance, type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

// The exact policy Part 1's spike measured for the built React shell under
// a strict CSP (docs/phases/p4d.md, "React Aria under a strict CSP"). Set
// directly rather than through `pageHeaders` (@odudu/kernel): that
// function's policy describes a markup-only page, and this one licenses a
// self-hosted script and a style hash instead.
const SHELL_CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

interface Asset {
  readonly content: Buffer;
  readonly contentType: string;
}

async function readAssets(assetsDir: string): Promise<Map<string, Asset>> {
  const assets = new Map<string, Asset>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const contentType = ASSET_CONTENT_TYPES[extname(entry.name)];
      if (contentType === undefined) continue;
      const key = relative(assetsDir, full).split(sep).join('/');
      assets.set(key, { content: await readFile(full), contentType });
    }
  }
  await walk(assetsDir);
  return assets;
}

function sendUnavailable(reply: FastifyReply): FastifyReply {
  return reply.code(503).type('text/plain; charset=utf-8').send('console build unavailable');
}

function sendShell(reply: FastifyReply, shell: Buffer): FastifyReply {
  return reply
    .code(200)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', SHELL_CSP)
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'no-referrer')
    .header('cache-control', 'no-store')
    .send(shell);
}

function registerUnavailable(fastify: FastifyInstance, consoleDir: string): void {
  fastify.log.warn(
    `ODUDU_CONSOLE_DIR (${consoleDir}) has no console build; /console/* answers 503`,
  );
  fastify.get('/console/*', (_request, reply) => sendUnavailable(reply));
}

// Reads the built console once, at registration, into an in-memory
// manifest — so no request ever touches the filesystem, and an asset path
// that is not an exact manifest key gets 404. That covers every form of
// path traversal, since nothing is read from disk per request.
export function spaRoutes(consoleDir: string): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/console', (_request, reply) => reply.code(308).redirect('/console/'));

    let shell: Buffer;
    try {
      shell = await readFile(join(consoleDir, 'index.html'));
    } catch {
      registerUnavailable(fastify, consoleDir);
      return;
    }
    const assets = await readAssets(join(consoleDir, 'assets')).catch(
      () => new Map<string, Asset>(),
    );

    fastify.get<{ Params: { '*': string } }>('/console/assets/*', (request, reply) => {
      const asset = assets.get(request.params['*']);
      if (asset === undefined) return reply.code(404).send();
      return reply
        .code(200)
        .header('content-type', asset.contentType)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(asset.content);
    });

    fastify.get('/console/*', (_request, reply) => sendShell(reply, shell));
  };
}
