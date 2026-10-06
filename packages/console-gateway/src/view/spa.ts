import { type FastifyInstance, type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

// The exact policy measured for the built React shell under a strict CSP —
// see docs/phases/p4d.md, "React Aria under a strict CSP". Set directly
// rather than through `pageHeaders` (@odudu/kernel): that function's
// policy describes a markup-only page, and this one licenses a
// self-hosted script and style hashes instead. The hashes are React Aria's
// two injected styles, usePress's and usePreventScroll's iOS one, which
// react-aria-style.test.ts recomputes from the pinned source.
export const SHELL_CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' " +
  "'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; " +
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

// A console asset this large is not a hashed build artefact; refusing it
// keeps a misconfigured `ODUDU_CONSOLE_DIR` from being read wholesale into
// memory at boot.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Vite's default `[hash]` is an 8-or-more character xxhash, base64url-encoded
// (rollup's `hashCharacters: 'base64'`, the default) — never longer than the
// name it is appended to. Anything else is a fixed name and must revalidate.
const CONTENT_HASHED_NAME = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u;

interface Asset {
  readonly content: Buffer;
  readonly contentType: string;
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

async function readAssets(
  assetsDir: string,
  warn: (message: string) => void,
): Promise<Map<string, Asset>> {
  // The files of the built console, read once when the gateway starts: the
  // build's own size, each file at most MAX_FILE_BYTES.
  const assets = new Map<string, Asset>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      // `readdir`'s dirents are lstat-based: a symlink is never `isFile()`,
      // whatever it points at, so this keeps the walk from ever following
      // one out of the built directory.
      if (!entry.isFile()) continue;
      const contentType = ASSET_CONTENT_TYPES[extname(entry.name)];
      if (contentType === undefined) continue;
      const stats = await lstat(full);
      if (stats.size > MAX_FILE_BYTES) {
        warn(`console asset over 10 MB, refused: ${full}`);
        continue;
      }
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

function registerUnavailable(fastify: FastifyInstance, consoleDir: string, reason: string): void {
  fastify.log.warn(
    `ODUDU_CONSOLE_DIR (${consoleDir}) has no console build (${reason}); /console/* answers 503`,
  );
  fastify.get('/console/*', (_request, reply) => sendUnavailable(reply));
}

async function readShell(indexPath: string): Promise<Buffer> {
  const stats = await lstat(indexPath);
  if (!stats.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' });
  if (stats.size > MAX_FILE_BYTES) throw Object.assign(new Error('over 10 MB'), { code: 'EFBIG' });
  return readFile(indexPath);
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
      shell = await readShell(join(consoleDir, 'index.html'));
    } catch (err) {
      registerUnavailable(fastify, consoleDir, errnoCode(err) ?? 'unknown error');
      return;
    }

    let assets: Map<string, Asset>;
    try {
      assets = await readAssets(join(consoleDir, 'assets'), (message) => {
        fastify.log.warn(message);
      });
    } catch (err) {
      registerUnavailable(fastify, consoleDir, errnoCode(err) ?? 'unknown error');
      return;
    }

    fastify.get<{ Params: { '*': string } }>('/console/assets/*', (request, reply) => {
      const asset = assets.get(request.params['*']);
      if (asset === undefined) return reply.code(404).send();
      const cacheControl = CONTENT_HASHED_NAME.test(request.params['*'])
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      return reply
        .code(200)
        .header('content-type', asset.contentType)
        .header('cache-control', cacheControl)
        .send(asset.content);
    });

    fastify.get('/console/*', (_request, reply) => sendShell(reply, shell));
  };
}
