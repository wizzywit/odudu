import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../packages/mcp/src/service/catalogue.js';
import { REPO_ROOT } from './markdown.js';

const READ = TOOLS.filter((tool) => tool.access === 'read').length;
const WRITE = TOOLS.filter((tool) => tool.access === 'write').length;

// Pages that state how many tools the endpoint offers. The count is read
// from the catalogue, so adding or removing a tool fails here until each
// page that says a number has been corrected.
const PAGES = [
  'README.md',
  'CHANGELOG.md',
  'docs/NEXT.md',
  'apps/docs/content/en/roadmap.md',
  'apps/docs/src/features/landing/services/capabilityCards.ts',
];

const WORDS: Record<string, number> = { two: 2, seven: 7 };
const number = (word: string): number => WORDS[word] ?? Number(word);

describe('the MCP tool counts the documents state', () => {
  it('are the catalogue’s: 61 read tools and 7 write tools', () => {
    expect(READ).toBe(61);
    expect(WRITE).toBe(7);
    expect(TOOLS).toHaveLength(READ + WRITE);
  });

  it.each(PAGES)('%s names no other count', (file) => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const reads = [...text.matchAll(/\b(\d+)\s+(?:read\s+tools|tools\s+that\s+read)/gu)];
    const writes = [...text.matchAll(/\b(\d+|two|seven)\s+write\s+tools/gu)];
    for (const m of reads) expect(number(m[1] ?? ''), m[0]).toBe(READ);
    for (const m of writes) expect(number(m[1] ?? ''), m[0]).toBe(WRITE);
  });

  it('is said at least once, so the check reads something', () => {
    const said = PAGES.flatMap((file) => [
      ...readFileSync(path.join(REPO_ROOT, file), 'utf8').matchAll(
        /\b61\s+(?:read\s+tools|tools\s+that\s+read)/gu,
      ),
    ]);
    expect(said.length).toBeGreaterThanOrEqual(3);
  });
});
