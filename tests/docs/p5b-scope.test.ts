import { describe, expect, it } from 'vitest';
import { loadDocument, loadSource, tableWithHeadings } from './markdown.js';

// P5b is the phase the parity work hands the access-changing, credential and
// destructive routes to. Its name, its row in section 11, the roadmap line and
// the two documents a later session starts from have to say the same thing, and
// the counts they print are the route table's.
const ROADMAP = 'apps/docs/content/en/roadmap.md';
const SPEC = 'docs/superpowers/specs/2026-09-10-odudu-design.md';
const NEXT = 'docs/NEXT.md';
const PHASE_NOTE = 'docs/phases/p5a.md';
const CLASSES_DOC = 'docs/protocols/mcp-route-classes.md';
const HEADING = '## What P5b inherits';
const NAME = 'MCP server: access-changing and destructive tools';

const squash = (text: string): string => text.replace(/\s+/gu, ' ').toLowerCase();

function line(file: string, start: RegExp): string {
  const found = loadDocument(file).lines.find((text) => start.test(text));
  if (found === undefined) throw new Error(`${file}: no line matching ${String(start)}`);
  return found;
}

function section(file: string): string {
  const lines = loadDocument(file).lines;
  const from = lines.indexOf(HEADING);
  if (from === -1) throw new Error(`${file} has no "${HEADING}"`);
  const length = lines.slice(from + 1).findIndex((text) => text.startsWith('## '));
  return lines.slice(from, length === -1 ? undefined : from + 1 + length).join('\n');
}

const PLACEMENTS = {
  roadmap: line(ROADMAP, /^- \*\*P5b/u),
  row: line(SPEC, /^\| P5b +\|/u),
};

describe('P5b as the roadmap and section 11 place it', () => {
  it.each(Object.entries(PLACEMENTS))('%s carries the widened identity', (_, text) => {
    const words = squash(text);
    for (const word of ['access-changing', 'destructive', 'credential', 'confirmation']) {
      expect(words, word).toContain(word);
    }
  });

  it('is named as the phase for access-changing and destructive tools', () => {
    expect(squash(PLACEMENTS.row)).toContain(squash(NAME));
    expect(squash(PLACEMENTS.roadmap)).toContain('access-changing');
  });

  it('names the three classes, the three confirmations and the work list in its row', () => {
    const row = PLACEMENTS.row;
    for (const word of ['W2', 'elicitation', 'CIBA', 'step-up', CLASSES_DOC]) {
      expect(row, word).toContain(word);
    }
    expect(row).toMatch(/\bC, the credential/u);
    expect(row).toMatch(/\bD, the destructive/u);
  });
});

describe('the P5a row of section 11', () => {
  const row = line(SPEC, /^\| P5a +\|/u);

  it('states the scope that shipped, not the first release’s', () => {
    const words = squash(row);
    for (const word of ['content writes', 'write budget', 'mcp-route-classes.md', '10 creates']) {
      expect(words, word).toContain(word);
    }
    expect(words).not.toContain('a scope’s or client’s descriptive metadata');
    expect(words).not.toContain("a scope's or client's descriptive metadata");
  });
});

describe('what P5b inherits', () => {
  it.each([
    [NEXT, 'protocols/mcp-route-classes.md'],
    [PHASE_NOTE, '../protocols/mcp-route-classes.md'],
  ])('%s has the section and links the route classes document', (file, link) => {
    expect(section(file)).toContain(`](${link})`);
  });

  it('prints each class the phase owns with the route table’s count', () => {
    const counts = tableWithHeadings(loadSource(CLASSES_DOC), ['Class', 'Routes']);
    const count = (cls: string): string => counts.rows.find(([name]) => name === cls)?.[1] ?? '';
    for (const file of [NEXT, PHASE_NOTE]) {
      const text = section(file);
      for (const cls of ['W2', 'C', 'D']) {
        expect(count(cls), cls).not.toBe('');
        expect(text, `${file} ${cls}`).toMatch(
          new RegExp(`\\b${cls}\\b[^\\n]*\\b${count(cls)}\\b`, 'u'),
        );
      }
    }
  });

  it.each([NEXT, PHASE_NOTE])('%s names the open decisions', (file) => {
    const text = squash(section(file));
    for (const word of [
      'confirmation',
      'tenant',
      'bulk',
      'binary',
      'mail',
      'replaced draft',
      'create_scope',
      'injection',
    ]) {
      expect(text, word).toContain(word);
    }
  });

  it('keeps no closed-phase argument about P5b outside the section', () => {
    const stray = loadDocument(NEXT).lines.filter(
      (text) => /\bP5b\b/u.test(text) && text.startsWith('| '),
    );
    const inside = section(NEXT);
    expect(stray.filter((text) => !inside.includes(text))).toEqual([]);
  });
});
