import { describe, expect, it } from 'vitest';
import { loadDocument, sections } from './markdown.js';

const GUIDE = 'docs/NEXT.md';

// This file reached 1,873 lines once, of which 58 described the position it
// exists to describe. Splitting the phase notes out fixed that leak; eight
// days and three phases later it was back to 525, through a different one —
// items placed against a distant phase, each kept here at the length of its
// own argument. "Keep NEXT.md short" cannot fail, and a rule that cannot
// fail is the rule that was in force for both of those.
const TOTAL = 400;

// The total alone can be met by squeezing "Start here" to feed a backlog,
// which is precisely the inversion that produced the 1,873-line file: every
// section honest, the proportion absurd. A per-section ceiling is what makes
// the next entry in an already-large section arrive as a row and a link
// rather than as three more paragraphs.
const PER_SECTION = 130;

// `loadDocument` splits on \n, so a file ending in one yields a final empty
// entry that is not a line anybody wrote. Counting it would report 401 for a
// 400-line file and refuse it, and the overage in the failure message is the
// thing a reader acts on.
function physicalLines(lines: readonly string[]): number {
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

interface Measured {
  readonly heading: string;
  readonly headingLine: number;
  readonly lines: number;
}

function measure(): Measured[] {
  const document = loadDocument(GUIDE);
  return sections(document, 4).map((section) => ({
    heading: section.heading,
    headingLine: section.headingLine,
    lines: physicalLines(section.body.split('\n')),
  }));
}

describe('docs/NEXT.md stays the size of an orientation', () => {
  it(`holds the whole file under ${String(TOTAL)} lines`, () => {
    const total = physicalLines(loadDocument(GUIDE).lines);
    const verdict = total <= TOTAL ? 'within budget' : `OVER by ${String(total - TOTAL)}`;
    expect(`${GUIDE}: ${String(total)} lines, ${verdict}`).toBe(
      `${GUIDE}: ${String(total)} lines, within budget`,
    );
  });

  it(`holds every section under ${String(PER_SECTION)} lines`, () => {
    for (const { heading, headingLine, lines } of measure()) {
      const where = `${GUIDE}:${String(headingLine)} (## ${heading})`;
      const verdict =
        lines <= PER_SECTION ? 'within budget' : `OVER by ${String(lines - PER_SECTION)}`;
      expect(`${where}: ${String(lines)} lines, ${verdict}`).toBe(
        `${where}: ${String(lines)} lines, within budget`,
      );
    }
  });
});
