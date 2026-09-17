import { describe, expect, it } from 'vitest';
import { loadDocument } from './markdown.js';

const GUIDE = 'docs/request-paths.md';
const HEADING = '## What is not implemented';

// A phase (P3, P4b, P13), a decision, or an ADR. Anything else is an item
// whose reader cannot tell a deliberate omission from a forgotten one, which
// is the whole failure this section exists to prevent.
const PLACED = /\bP\d+[a-z]?\b|\bdecision\b|\bADR \d+\b/u;

interface Item {
  text: string;
  lineNumber: number;
}

function itemsUnderHeading(): Item[] {
  const { lines } = loadDocument(GUIDE);
  const start = lines.findIndex((line) => line.startsWith(HEADING));
  if (start === -1) throw new Error(`${GUIDE} has no ${JSON.stringify(HEADING)} section`);

  const items: Item[] = [];
  let current: Item | null = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) {
      if (current !== null) items.push(current);
      current = { text: line, lineNumber: index + 1 };
    } else if (current !== null && /^\s+\S/u.test(line)) {
      current.text += ` ${line.trim()}`;
    }
  }
  if (current !== null) items.push(current);
  return items;
}

describe('every gap docs/request-paths.md names has somewhere to be', () => {
  const items = itemsUnderHeading();

  it('finds the list, so a renamed heading fails rather than passing vacuously', () => {
    expect(items.length).toBeGreaterThan(20);
  });

  it('places every item against a phase, a decision or an ADR', () => {
    for (const { text, lineNumber } of items) {
      const where = `${GUIDE}:${String(lineNumber)}`;
      const summary = text.replace(/^- /u, '').replace(/\*\*/gu, '').slice(0, 60);
      expect(`${where} (${summary}): ${PLACED.test(text) ? 'placed' : 'UNPLACED'}`).toBe(
        `${where} (${summary}): placed`,
      );
    }
  });

  // The word the roadmap used for the five items that had no phase. They
  // have one now, and reintroducing the escape hatch is the thing to catch.
  it('leaves nothing calling itself unplaced', () => {
    for (const { text, lineNumber } of items) {
      expect(`${GUIDE}:${String(lineNumber)}: ${/unplaced/iu.test(text) ? 'unplaced' : 'ok'}`).toBe(
        `${GUIDE}:${String(lineNumber)}: ok`,
      );
    }
  });
});
