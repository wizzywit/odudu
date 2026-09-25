import { describe, expect, it } from 'vitest';
import { loadDocument, scanFences, tableWithHeadings, type Document } from './markdown.js';

// The roadmap table is the only place a phase is defined. `docs/request-paths.md`
// and `README.md` cite phases in prose, and prose drifts silently: P2 became
// P2a and P2b on 2026-09-13 and both documents went on naming a phase that had
// stopped existing, for a day, with every test green.
//
// The suffix is any letter, not `a` or `b`. Narrower, this saw neither `P4c`
// nor `P4e` in prose — `\bP\d+[ab]?\b` matches nothing in "P4c", so those
// citations were unchecked for as long as they existed.
const ROADMAP = 'docs/superpowers/specs/2026-09-10-odudu-design.md';

const CITING_DOCUMENTS: readonly (readonly [name: string, atLeast: number])[] = [
  ['README.md', 6],
  ['docs/request-paths.md', 20],
];

function roadmapPhases(): Set<string> {
  const table = tableWithHeadings(loadDocument(ROADMAP), [
    '#',
    'Phase',
    'Effort',
    'Exit criterion',
  ]);
  const phases = table.rows.map((row) => row[0] ?? '').filter((cell) => /^P\d+[a-z]?$/u.test(cell));

  if (phases.length < 12) {
    throw new Error(
      `${ROADMAP} yielded ${String(phases.length)} phase identifiers from its roadmap table; ` +
        `there were at least 12, so the table moved or this extractor stopped recognising it.`,
    );
  }
  return new Set(phases);
}

interface Citation {
  readonly phase: string;
  // 1-based, so a failure message points at something a reader can open.
  readonly line: number;
}

// Fenced blocks are skipped: they hold real transcripts, and a base64 token or
// a key fingerprint is not a claim about the roadmap.
function phaseCitations(document: Document): Citation[] {
  const found: Citation[] = [];

  const { fenced } = scanFences(document);
  document.lines.forEach((line, index) => {
    if (fenced[index] === true) return;
    for (const match of line.matchAll(/\bP\d+[a-z]?\b/gu)) {
      found.push({ phase: match[0], line: index + 1 });
    }
  });

  return found;
}

describe('every phase these documents name is a phase the roadmap has', () => {
  const phases = roadmapPhases();

  it('reads P2 as two phases, not one', () => {
    expect([...phases].filter((phase) => phase.startsWith('P2')).sort()).toEqual(['P2a', 'P2b']);
  });

  for (const [name, atLeast] of CITING_DOCUMENTS) {
    it(`every phase ${name} cites exists`, () => {
      const citations = phaseCitations(loadDocument(name));

      expect(
        citations.length,
        `${name} cites ${String(citations.length)} phases; at least ${String(atLeast)} were ` +
          `there when this check was written, so either they moved out of the document or ` +
          `this extractor stopped recognising them`,
      ).toBeGreaterThanOrEqual(atLeast);

      const unknown = citations
        .filter((citation) => !phases.has(citation.phase))
        .map((citation) => `${name}:${String(citation.line)} names ${citation.phase}`);

      expect(unknown, `these name a phase the roadmap table in ${ROADMAP} does not define`).toEqual(
        [],
      );
    });
  }
});
