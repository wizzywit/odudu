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

// Pages and served text that describe what the write tools are, in words no
// count pattern reads.
const PROSE = [
  ...PAGES,
  'apps/docs/content/en/guides/connect-claude.md',
  'apps/docs/content/en/guides/connect-cursor.md',
  'apps/docs/content/en/guides/machine-to-machine.md',
  'apps/docs/content/en/guides/protect-an-mcp-server.md',
  'apps/docs/content/en/reference/transcripts/request-paths/the-mcp-write-tools.md',
  'apps/docs/content/en/reference/transcripts/request-paths/the-mcp-endpoint.md',
  'apps/docs/content/en/reference/transcripts/request-paths/odudu-mcp-over-stdio.md',
  'apps/server/src/endpoint-docs.ts',
];

const WORDS: Record<string, number> = { two: 2, seven: 7, ten: 10, twelve: 12 };
const number = (word: string): number => WORDS[word] ?? Number(word);

describe('the MCP tool counts the documents state', () => {
  it('are the catalogue’s: 64 read tools and 12 write tools', () => {
    expect(READ).toBe(64);
    expect(WRITE).toBe(12);
    expect(TOOLS).toHaveLength(READ + WRITE);
  });

  it.each(PAGES)('%s names no other count', (file) => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const reads = [...text.matchAll(/\b(\d+)\s+(?:read\s+tools|tools\s+that\s+read)/gu)];
    const writes = [...text.matchAll(/\b(\d+|two|seven|ten|twelve)\s+write\s+tools/gu)];
    for (const m of reads) expect(number(m[1] ?? ''), m[0]).toBe(READ);
    for (const m of writes) expect(number(m[1] ?? ''), m[0]).toBe(WRITE);
  });

  it('is said at least once, so the check reads something', () => {
    const said = PAGES.flatMap((file) => [
      ...readFileSync(path.join(REPO_ROOT, file), 'utf8').matchAll(
        /\b64\s+(?:read\s+tools|tools\s+that\s+read)/gu,
      ),
    ]);
    expect(said.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a worded count of tools that write', () => {
  const COUNTS: Record<string, number> = {
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
  };

  it.each(PROSE)('%s counts them as the catalogue does, capitalised or not', (file) => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const m of text.matchAll(
      /\b(ten|eleven|twelve|thirteen|fourteen)\s+(?:more\s+|write\s+)?tools\b/giu,
    )) {
      expect(COUNTS[(m[1] ?? '').toLowerCase()], `${file}: ${m[0]}`).toBe(WRITE);
    }
  });
});

describe('the words that say what the write tools are', () => {
  it.each(PROSE)('%s never says the writes are two or seven, or only descriptive text', (file) => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const stale = [
      ...text.matchAll(
        /\b(?:the\s+)?two\s+(?:more\s+(?!tools,\s+`list_tenants`)|write\s+)?tools\b/gu,
      ),
      ...text.matchAll(/\bthe\s+two\s+that\s+change\b/gu),
      ...text.matchAll(/\b(?:the\s+)?seven\s+(?:write\s+)?(?:tools|writes)\b/gu),
      ...text.matchAll(/\bthrough\s+seven\s+tools\b/gu),
      ...text.matchAll(/\bnot\s+through\s+`odudu\s+mcp`.{0,40}\bthe\s+three\s+creates\b/gu),
      ...text.matchAll(
        /descriptive\s+text\s+of\s+(?:a\s+)?clients?\s+(?:and|or)\s+(?:a\s+)?scopes?\b/gu,
      ),
      ...text.matchAll(/\bEach\s+tool\s+takes\s+the\s+`etag`/gu),
    ];
    expect(
      stale.map((m) => m[0]),
      `${file} describes the write tools as they were`,
    ).toEqual([]);
  });
});
