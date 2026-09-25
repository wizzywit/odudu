import { describe, expect, it } from 'vitest';
import { loadDocument, scanFences, structuralProblems } from './markdown.js';

// The documents whose fenced blocks are captured output rather than
// illustration. A malformed fence in one turns prose into code and takes any
// heading below it out of existence, killing every anchor that points there.
// Prettier reformats around a broken fence rather than refusing it, so a
// document can be cleanly formatted and unreadable at once.
//
// `atLeast` is a floor, not a count to keep current: without it, a scanner
// that stopped seeing fences would report no blocks and so no problems.
const DOCUMENTS: readonly (readonly [name: string, atLeast: number])[] = [
  ['docs/request-paths.md', 400],
  ['docs/admin-paths.md', 80],
  ['README.md', 20],
];

describe('the documents whose fenced blocks are captured output are structurally sound', () => {
  for (const [name, atLeast] of DOCUMENTS) {
    it(`${name} has no fence that swallows what follows it`, () => {
      const document = loadDocument(name);

      expect(
        structuralProblems(document).map(
          (problem) => `${name}:${String(problem.line)} ${problem.what}`,
        ),
        `${name} renders differently from how it reads in source`,
      ).toEqual([]);
    });

    it(`${name} still parses as a document with fenced blocks in it`, () => {
      const blocks = scanFences(loadDocument(name)).spans;

      expect(
        blocks.length,
        `${name} yielded ${String(blocks.length)} fenced blocks; there were at least ` +
          `${String(atLeast)} when this check was written, so either they left the document ` +
          `or the scanner stopped recognising them and the check above holds nothing`,
      ).toBeGreaterThanOrEqual(atLeast);
    });
  }
});
