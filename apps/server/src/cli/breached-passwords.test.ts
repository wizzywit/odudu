import { describe, expect, it } from 'vitest';
import {
  breachedPasswordsCommand,
  CHUNK_ROWS,
  loadHashLines,
  parseHashLine,
  type HashRow,
} from '#/cli/breached-passwords';

const A = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';

describe('parseHashLine', () => {
  it('splits a hash into five characters and thirty-five, dropping the count', () => {
    expect(parseHashLine(`${A}:3730471`)).toEqual({ prefix: A.slice(0, 5), suffix: A.slice(5) });
  });

  it('takes a hash with no count, in lower case, with a trailing carriage return', () => {
    expect(parseHashLine(`${A.toLowerCase()}\r`)).toEqual({
      prefix: A.slice(0, 5),
      suffix: A.slice(5),
    });
  });

  it('skips a blank line', () => {
    expect(parseHashLine('')).toBeNull();
    expect(parseHashLine('  \r')).toBeNull();
  });

  it('refuses what is not a forty-character SHA-1', () => {
    for (const bad of [
      'hello',
      A.slice(1),
      `${A}0`,
      'G'.repeat(40),
      '8846F7EAEE8FB117AD06BDD830B7586C',
    ]) {
      expect(() => parseHashLine(bad), bad).toThrow(/SHA-1/u);
    }
  });
});

function* hashLines(count: number): Generator<string> {
  for (let index = 0; index < count; index += 1) {
    yield `${index.toString(16).toUpperCase().padStart(40, '0')}:1`;
  }
}

// An async source, as a file stream is, over the same lines.
async function* linesOf(count: number): AsyncGenerator<string> {
  await Promise.resolve();
  yield* hashLines(count);
}

describe('loadHashLines', () => {
  it('inserts in chunks of at most the chunk size and reports what it read and added', async () => {
    const chunks: number[] = [];
    const report = await loadHashLines(linesOf(CHUNK_ROWS * 2 + 17), (rows: readonly HashRow[]) => {
      chunks.push(rows.length);
      return Promise.resolve(rows.length);
    });
    expect(chunks).toEqual([CHUNK_ROWS, CHUNK_ROWS, 17]);
    expect(report).toEqual({ read: CHUNK_ROWS * 2 + 17, inserted: CHUNK_ROWS * 2 + 17 });
  });

  it('counts only the rows the insert reports as new', async () => {
    const report = await loadHashLines(linesOf(10), (rows) => Promise.resolve(rows.length - 4));
    expect(report).toEqual({ read: 10, inserted: 6 });
  });

  it('holds one chunk at a time while reading, never the file', async () => {
    let produced = 0;
    let insertedSoFar = 0;
    let widest = 0;
    async function* counting(): AsyncGenerator<string> {
      for await (const line of linesOf(CHUNK_ROWS * 3)) {
        produced += 1;
        widest = Math.max(widest, produced - insertedSoFar);
        yield line;
      }
    }
    await loadHashLines(counting(), (rows) => {
      insertedSoFar += rows.length;
      return Promise.resolve(rows.length);
    });
    expect(widest).toBeLessThanOrEqual(CHUNK_ROWS);
  });

  it('names the line that is not a hash, after the chunks before it were inserted', async () => {
    async function* bad(): AsyncGenerator<string> {
      yield* linesOf(3);
      yield 'not a hash';
    }
    const inserted: number[] = [];
    await expect(
      loadHashLines(bad(), (rows) => {
        inserted.push(rows.length);
        return Promise.resolve(rows.length);
      }),
    ).rejects.toThrow(/line 4/u);
    expect(inserted).toEqual([]);
  });
});

describe('breachedPasswordsCommand', () => {
  it('refuses anything but load with one file, or status with none', async () => {
    for (const argv of [[], ['load'], ['load', 'a', 'b'], ['status', 'a'], ['other']]) {
      await expect(breachedPasswordsCommand(argv), argv.join(' ')).rejects.toThrow(/usage/u);
    }
  });
});
