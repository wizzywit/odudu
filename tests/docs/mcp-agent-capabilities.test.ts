import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../packages/mcp/src/service/catalogue.js';
import { directCallerTools } from '../../packages/mcp/src/service/visible-tools.js';
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

const WRITE_TOOLS = TOOLS.filter((tool) => tool.access === 'write');
const ENDPOINT_ONLY = WRITE_TOOLS.length - directCallerTools(WRITE_TOOLS).length;
const WORDED: Record<number, string> = { 5: 'five', 7: 'seven' };
const WITH_A_TOOL = Number(
  /\*\*(\d+) of them have a tool today\*\*/u.exec(read(CLASSES_DOC))?.[1] ?? Number.NaN,
);

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

  it('says how many writes have a tool, as the route classes document does, and which need the endpoint', () => {
    expect(WITH_A_TOOL).toBe(WRITE_TOOLS.length);
    const [, today = ''] = rows.get('W1') ?? [];
    expect(today).toContain(`Yes for ${String(WITH_A_TOOL)}`);
    expect(today).toContain(WORDED[ENDPOINT_ONLY] ?? 'unnamed');
    expect(today).toMatch(/only through the tenant's MCP endpoint/u);
  });

  it('says what happens when the allowance for changes runs out', () => {
    const text = squash(read(file));
    expect(text).toContain('mcp:write_budget');
    expect(text).toContain('signs in again');
  });

  it('says that access-changing and destructive operations are not available yet', () => {
    expect(squash(read(file))).toMatch(
      /access-changing[^.]*destructive[^.]*(?:not available|are not offered)[^.]*yet/u,
    );
  });
});

describe('the concept page and the landing page', () => {
  it('tell the same thing in a sentence each', () => {
    const concept = squash(read(CONCEPT));
    expect(concept).toMatch(/access-changing[^.]*destructive[^.]*not available[^.]*yet/u);
    expect(squash(read(CARDS))).toMatch(/access-changing[^.']*destructive[^.']*not available yet/u);
  });
});
