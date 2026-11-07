import { statSync } from 'node:fs';
import path from 'node:path';
import { DOCS_LIMITS } from '@odudu/web-assets';
import { describe, expect, it } from 'vitest';
import { distDir, walk } from '#docs/tests/support/dist.ts';

// The server holds the built site in memory and leaves out a file past its
// limits, so a page or the search index that grew past one is a 404 in the
// image and nothing in the build says so. A quarter of each limit stays free.
const HEADROOM = 0.75;

describe('the image build against the limits of the server that holds it', () => {
  const dir = distDir('image');
  const files = walk(dir).map((file) => ({
    name: path.relative(dir, file),
    bytes: statSync(file).size,
  }));

  it('has no file near the largest the server serves', () => {
    const near = files.filter((file) => file.bytes > DOCS_LIMITS.maxFileBytes * HEADROOM);
    expect(near.map((file) => `${file.name} ${String(file.bytes)}`)).toEqual([]);
  });

  it('holds fewer files and bytes than the server keeps, with room to grow', () => {
    expect(files.length).toBeLessThan(DOCS_LIMITS.maxFiles * HEADROOM);
    const total = files.reduce((sum, file) => sum + file.bytes, 0);
    expect(total).toBeLessThan(DOCS_LIMITS.maxTotalBytes * HEADROOM);
  });
});
