import { type StaticTreeLimits } from '@odudu/kernel';

export const DOCS_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// The built site is about 1,000 files and 44 MiB, the search index alone 10 MiB.
// These bound what a directory that is not the build can make the server hold
// in memory; a file past `maxFileBytes` is left out and answers 404.
export const DOCS_LIMITS: StaticTreeLimits = {
  maxFileBytes: 16 * 1024 * 1024,
  maxFiles: 5_000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntries: 100_000,
};

// Docusaurus names a chunk `<name>.<8 hex>.js`, a stylesheet
// `styles.<8 hex>.css` and a font `<name>-<32 hex>.woff2`, all under
// `assets/`. Every other file keeps a fixed name and must revalidate.
const CONTENT_HASHED = /^assets\/.+[.-][0-9a-f]{8,32}\.[a-z0-9]+$/u;

export function cacheControlFor(path: string): string {
  return CONTENT_HASHED.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
}
