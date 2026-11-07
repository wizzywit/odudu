import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadDocument, tableWithHeadings } from './markdown.js';

// What an agent can and cannot do is told to a reader in the three MCP guides
// by one table, and in a sentence on the concept page and the landing page. The
// counts in it are the route classes document's, so a route that moves class
// fails here until the table says so.
const CLASSES_DOC = 'docs/protocols/mcp-route-classes.md';
const CONTENT = 'apps/docs/content/en';
const GUIDES = [
  `${CONTENT}/guides/connect-claude.md`,
  `${CONTENT}/guides/connect-cursor.md`,
  `${CONTENT}/guides/protect-an-mcp-server.md`,
];
const CONCEPT = `${CONTENT}/concepts/consent-and-audit.mdx`;
const CARDS = 'apps/docs/src/features/landing/services/capabilityCards.ts';
const HEADINGS = [
  'Class',
  'Routes',
  'An agent today',
  'Why, and what a person does instead',
] as const;
const CLASSES = ['R', 'I', 'W1', 'W2', 'C', 'D', 'RS', 'N'] as const;
const TODAY: Record<string, RegExp> = {
  R: /^Yes/u,
  I: /^Yes/u,
  W1: /^Yes/u,
  W2: /^Not yet/u,
  C: /^Not yet/u,
  D: /^Not yet/u,
  RS: /^Never/u,
  N: /^Never/u,
};

const read = (file: string): string => readFileSync(path.join(REPO_ROOT, file), 'utf8');
const squash = (text: string): string => text.replace(/\s+/gu, ' ').toLowerCase();

const printed = tableWithHeadings(loadDocument(CLASSES_DOC), ['Class', 'Routes']);
const COUNTS = Object.fromEntries(printed.rows.map(([cls = '', n = '']) => [cls, n]));

describe.each(GUIDES)('%s', (file) => {
  const table = tableWithHeadings(loadDocument(file), HEADINGS);
  const rows = new Map(table.rows.map(([cls = '', ...rest]) => [cls, rest]));

  it('has a row for every class, in the route table’s order', () => {
    expect([...rows.keys()]).toEqual([...CLASSES]);
  });

  it('prints the route classes document’s count for each class', () => {
    for (const cls of CLASSES) expect(rows.get(cls)?.[0], cls).toBe(COUNTS[cls]);
  });

  it('says what an agent can do today and, for the rest, why and what a person does', () => {
    for (const cls of CLASSES) {
      const [, today = '', why = ''] = rows.get(cls) ?? [];
      expect(today, cls).toMatch(TODAY[cls] ?? /^$/u);
      expect(why.length, cls).toBeGreaterThan(60);
    }
    for (const cls of ['W2', 'C', 'D']) expect(rows.get(cls)?.[2], cls).toMatch(/console/u);
  });

  it('says that access-changing and destructive operations are not available yet', () => {
    expect(squash(read(file))).toMatch(
      /access-changing[^.]*destructive[^.]*(?:not available|are not offered)[^.]*yet/u,
    );
  });
});

describe('the concept page and the landing page', () => {
  it('tell the same thing in a paragraph and a sentence', () => {
    const concept = squash(read(CONCEPT));
    expect(concept).toMatch(/access-changing[^.]*destructive[^.]*not available[^.]*yet/u);
    expect(concept).toContain('20 changing calls and 10 creates');
    expect(squash(read(CARDS))).toMatch(/access-changing[^.']*destructive[^.']*not available yet/u);
  });
});
