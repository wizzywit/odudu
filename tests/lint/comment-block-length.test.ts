import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// "No ceremony, no verbose block headers" is unfalsifiable as written: a
// well-commented file and an over-commented one look identical to CI, so the
// drift is only ever caught by a human reading a diff. This is the falsifiable
// half — a ceiling on how much comment can sit in one uninterrupted run.

// The ceiling is deliberately generous. A comment carrying a clause reference,
// an ordering constraint, a rejected alternative or a failure mode fits inside
// it; what does not fit is an essay, and an essay's durable content belongs in
// an ADR or a docs/protocols/ reading note with a pointer from the code.
const MAX_BLOCK_WEIGHT = 8;

// Prettier's printWidth. A line wider than this is one line on disk and more
// than one line of reading, so it is weighted accordingly: the limit cannot be
// met by rewrapping the same essay into fewer, longer lines.
const PRINT_WIDTH = 100;

const SOURCE_TREES = [
  'packages/*/src/**/*.ts',
  'packages/*/tests/**/*.ts',
  'apps/*/src/**/*.ts',
  'apps/*/tests/**/*.ts',
  'tools/*/src/**/*.ts',
  'tests/**/*.ts',
  '*.ts',
];

export interface CommentBlock {
  readonly line: number;
  readonly weight: number;
}

// A block is every comment line in one run, where a run is broken only by a
// line of code. Blank lines do not break it: splitting a 26-line essay into
// three chunks separated by `//` or by nothing at all changes where the line
// breaks are, not how much prose a reader has to get past.

// Only a line whose first non-space character opens a comment counts. A
// trailing comment after code is short by construction and is not the drift
// this measures, and a line that is nothing but a delimiter is syntax rather
// than prose, so a JSDoc block gets the same budget as a `//` one.
export function commentBlocks(source: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = source.split('\n');
  let start: number | null = null;
  let weight = 0;
  let insideBlockComment = false;

  const flush = (): void => {
    if (start !== null) blocks.push({ line: start, weight });
    start = null;
    weight = 0;
  };

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    let isComment = insideBlockComment;

    if (insideBlockComment) {
      if (line.includes('*/')) insideBlockComment = false;
    } else if (line.startsWith('/*')) {
      isComment = true;
      insideBlockComment = !line.includes('*/');
    } else if (line.startsWith('//')) {
      isComment = true;
    }

    if (isComment) {
      start ??= index + 1;
      const delimiterOnly = line === '/**' || line === '/*' || line === '*/';
      if (!delimiterOnly) weight += Math.max(1, Math.ceil(line.length / PRINT_WIDTH));
    } else if (line !== '') {
      flush();
    }
  }

  flush();
  return blocks;
}

describe('a comment block stays within the ceiling', () => {
  it('holds across every source tree', async () => {
    const offenders: string[] = [];

    for (const pattern of SOURCE_TREES) {
      for await (const file of glob(pattern)) {
        const source = await readFile(file, 'utf8');
        for (const block of commentBlocks(source)) {
          if (block.weight <= MAX_BLOCK_WEIGHT) continue;
          offenders.push(
            `${file}:${String(block.line)} — comment block of ${String(block.weight)} lines, ` +
              `limit is ${String(MAX_BLOCK_WEIGHT)}. Compress it, or move what is durable to an ` +
              `ADR or a docs/protocols/ reading note and leave a one-line pointer.`,
          );
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// The counting rule is the whole guard: a limit on contiguous lines that can
// be met by pressing Enter is not a limit. These are the two ways to try.
describe('the ceiling cannot be met by reformatting', () => {
  const essay = Array.from({ length: 12 }, (_, i) => `// line ${String(i)}`);

  it('counts one run of comment lines as one block', () => {
    const blocks = commentBlocks(`${essay.join('\n')}\nexport const x = 1;\n`);
    expect(blocks).toEqual([{ line: 1, weight: 12 }]);
  });

  it('counts chunks separated by blank lines as one block', () => {
    const split = [...essay.slice(0, 4), '', ...essay.slice(4, 8), '', ...essay.slice(8)];
    const blocks = commentBlocks(`${split.join('\n')}\nexport const x = 1;\n`);
    expect(blocks).toEqual([{ line: 1, weight: 12 }]);
  });

  it('counts a wide line as the lines it reads as', () => {
    const wide = `// ${'w'.repeat(2 * PRINT_WIDTH)}`;
    const blocks = commentBlocks(`${wide}\nexport const x = 1;\n`);
    expect(blocks[0]?.weight).toBeGreaterThan(2);
  });

  it('leaves a comment trailing a line of code alone', () => {
    const blocks = commentBlocks('export const x = 1; // why\n');
    expect(blocks).toEqual([]);
  });

  it('gives a JSDoc block the same budget, not two lines less', () => {
    const prose = essay.map((line) => line.replace('//', ' *')).join('\n');
    const blocks = commentBlocks(`/**\n${prose}\n */\n`);
    expect(blocks).toEqual([{ line: 1, weight: 12 }]);
  });
});
