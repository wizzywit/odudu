import { type FastifyInstance, type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { readStaticTree, type StaticFile } from '@odudu/kernel';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The exact policy measured for the built React shell under a strict CSP —
// see docs/phases/p4d.md, "React Aria under a strict CSP". Set directly
// rather than through `pageHeaders` (@odudu/kernel): that function's
// policy describes a markup-only page, and this one licenses a
// self-hosted script and style hashes instead. The hashes are React Aria's
// two injected styles, usePress's and usePreventScroll's iOS one, which
// react-aria-style.test.ts recomputes from the pinned source. `frame-src` names
// what `default-src` gives, so the preview frame survives a narrower fallback.
export const SHELL_CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' " +
  "'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
  "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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

// Reads the `code` of a system error and of an `OduduError` alike, which is
// how a tree over its limits reaches `registerUnavailable` as a reason.
function errnoCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
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
    .header('x-content-type-options', 'nosniff')
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

    let assets: ReadonlyMap<string, StaticFile>;
    try {
      assets = await readStaticTree(
        join(consoleDir, 'assets'),
        ASSET_CONTENT_TYPES,
        {},
        (message) => {
          fastify.log.warn(`ODUDU_CONSOLE_DIR: ${message}`);
        },
      );
    } catch (err) {
      registerUnavailable(fastify, consoleDir, errnoCode(err) ?? 'unknown error');
      return;
    }

    fastify.get<{ Params: { '*': string } }>('/console/assets/*', (request, reply) => {
      const asset = assets.get(request.params['*']);
      if (asset === undefined) {
        return reply.code(404).header('x-content-type-options', 'nosniff').send();
      }
      const cacheControl = CONTENT_HASHED_NAME.test(request.params['*'])
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      return reply
        .code(200)
        .header('content-type', asset.contentType)
        .header('cache-control', cacheControl)
        .header('x-content-type-options', 'nosniff')
        .send(asset.content);
    });

    fastify.get('/console/*', (_request, reply) => sendShell(reply, shell));
  };
}
