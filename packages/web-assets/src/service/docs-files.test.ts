import { describe, expect, it } from 'vitest';
import { cacheControlFor, DOCS_LIMITS, DOCS_TYPES } from '#/service/docs-files';

describe('cacheControlFor', () => {
  it.each([
    'assets/js/main.04cfb3a2.js',
    'assets/js/04cfb3a2.94471eda.js',
    'assets/css/styles.886e0661.css',
    'assets/fonts/ibm-plex-mono-latin-400-normal-2b13cc93b07c41b27134e7b2c5d00d47.woff2',
  ])('never revalidates %s, which is named by its content', (path) => {
    expect(cacheControlFor(path)).toBe('public, max-age=31536000, immutable');
  });

  it.each([
    'index.html',
    'guides/index.html',
    'search-index.json',
    'llms.txt',
    'llms-full.txt',
    'introduction.md',
    'robots.txt',
    'brand/favicon.svg',
    'openapi/admin.json',
    // Under assets/ but not named by content: a name is not enough.
    'assets/js/main.js',
    'assets/js/main.zzzzzzzz.js',
    // Named by content but outside assets/.
    'notes.04cfb3a2.js',
  ])('revalidates %s', (path) => {
    expect(cacheControlFor(path)).toBe('no-cache');
  });
});

describe('what the documentation is served as', () => {
  it('types the built site by extension', () => {
    expect(DOCS_TYPES['.html']).toBe('text/html; charset=utf-8');
    expect(DOCS_TYPES['.json']).toBe('application/json');
    expect(DOCS_TYPES['.txt']).toBe('text/plain; charset=utf-8');
    expect(DOCS_TYPES['.md']).toBe('text/markdown; charset=utf-8');
    expect(DOCS_TYPES['.js']).toBe('text/javascript; charset=utf-8');
    expect(DOCS_TYPES['.webp']).toBe('image/webp');
    expect(DOCS_TYPES['.ico']).toBe('image/x-icon');
  });

  it('bounds the tree at 5,000 files, 64 MiB, and 16 MiB a file', () => {
    expect(DOCS_LIMITS.maxFiles).toBe(5_000);
    expect(DOCS_LIMITS.maxTotalBytes).toBe(64 * 1024 * 1024);
    expect(DOCS_LIMITS.maxFileBytes).toBe(16 * 1024 * 1024);
  });
});
