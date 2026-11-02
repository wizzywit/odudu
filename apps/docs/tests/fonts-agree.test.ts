import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const docs = readFileSync(path.join(DOCS_ROOT, 'src/css/fonts.css'), 'utf8');
const console_ = readFileSync(
  path.join(DOCS_ROOT, '../admin-console/src/shared/ui/fonts.css'),
  'utf8',
);

// The docs copy differs from the console's in its header comment and in `font-display`.
function faces(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll('font-display: optional;', 'font-display: swap;')
    .trim();
}

describe("the docs site's Plex faces", () => {
  it('are the console faces, apart from showing nothing late', () => {
    expect(faces(docs)).toBe(faces(console_));
    expect(docs.match(/font-display: optional;/gu)?.length).toBe(12);
    expect(docs).not.toContain('font-display: swap');
  });
});
